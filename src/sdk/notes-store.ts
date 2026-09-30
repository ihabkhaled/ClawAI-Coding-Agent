import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  NOTES_DIRECTORY_NAME,
  NOTES_MAX_BYTES,
  NOTES_MAX_COUNT,
  NOTES_NO_THREAD,
} from './notes-tool.constants';

import type { AgentNote, NotesFile, NotesStore, NotesStoreOptions } from './notes-tool.types';

const EMPTY: NotesFile = { version: 1, nextId: 1, notes: [] };

/** The file for one conversation: a hash, so the name never spells a path or a thread. */
export function notesFileFor(
  stateDirectory: string,
  workspace: string,
  threadId: string | undefined,
): string {
  const key = createHash('sha256')
    .update(`${path.resolve(workspace)}\n${threadId ?? NOTES_NO_THREAD}`)
    .digest('hex')
    .slice(0, 32);
  return path.join(stateDirectory, NOTES_DIRECTORY_NAME, `${key}.json`);
}

/** True when `file` sits inside `workspace`, where a commit could pick it up. */
export function isInside(workspace: string, file: string): boolean {
  const relative = path.relative(path.resolve(workspace), path.resolve(file));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isNote(value: unknown): value is AgentNote {
  if (typeof value !== 'object' || value === null) return false;
  const note = value as Record<string, unknown>;
  return (
    Number.isInteger(note.id) &&
    typeof note.text === 'string' &&
    typeof note.createdAt === 'string' &&
    (note.tag === undefined || typeof note.tag === 'string')
  );
}

/** Whatever the file holds; a missing or corrupt file is no notes at all. */
function readFileNotes(file: string): NotesFile {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return EMPTY;
    const { notes, nextId } = parsed as Record<string, unknown>;
    if (!Array.isArray(notes) || !notes.every(isNote)) return EMPTY;
    const highest = notes.reduce((most, note) => Math.max(most, note.id), 0);
    const next = typeof nextId === 'number' && Number.isInteger(nextId) ? nextId : 0;
    return { version: 1, nextId: Math.max(next, highest + 1), notes };
  } catch {
    return EMPTY;
  }
}

function writeFileNotes(file: string, data: NotesFile): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${String(process.pid)}.tmp`;
    writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
    renameSync(temporary, file);
  } catch {
    // The notes stay in memory: losing them across a restart beats failing a tool call.
  }
}

/**
 * The notes of one conversation: kept in memory, and written through to a file
 * under the state directory, never inside the workspace.
 *
 * The conversation is looked up on every call because the thread id only exists
 * once the first run has started; a different thread reads its own file.
 */
export function createNotesStore(options: NotesStoreOptions): NotesStore {
  const loaded: { file: string | undefined; key: string; data: NotesFile } = {
    file: undefined,
    key: '',
    data: EMPTY,
  };
  const current = (): NotesFile => {
    const key = options.threadId() ?? NOTES_NO_THREAD;
    if (loaded.key !== key || loaded.data === EMPTY) {
      const file = persistentFile(options, key);
      loaded.key = key;
      loaded.file = file;
      loaded.data = file === undefined ? EMPTY : readFileNotes(file);
    }
    return loaded.data;
  };
  const save = (data: NotesFile): void => {
    if (JSON.stringify(data).length > NOTES_MAX_BYTES) {
      throw new Error(
        `Notes are full (${String(NOTES_MAX_BYTES / 1024)} KB). Remove or replace older notes first.`,
      );
    }
    loaded.data = data;
    if (loaded.file !== undefined) writeFileNotes(loaded.file, data);
  };
  return {
    list: () => current().notes,
    add: (text, tag) => {
      const data = current();
      if (data.notes.length >= NOTES_MAX_COUNT) {
        throw new Error(`At most ${String(NOTES_MAX_COUNT)} notes. Remove or replace some first.`);
      }
      const note: AgentNote = {
        id: data.nextId,
        text,
        ...(tag === undefined ? {} : { tag }),
        createdAt: new Date().toISOString(),
      };
      save({ version: 1, nextId: data.nextId + 1, notes: [...data.notes, note] });
      return note;
    },
    replace: (id, text) => {
      const data = current();
      const found = data.notes.find((note) => note.id === id);
      if (found === undefined) throw new Error(`There is no note ${String(id)}.`);
      const note: AgentNote = { ...found, text };
      save({ ...data, notes: data.notes.map((entry) => (entry.id === id ? note : entry)) });
      return note;
    },
    remove: (id) => {
      const data = current();
      if (!data.notes.some((note) => note.id === id)) {
        throw new Error(`There is no note ${String(id)}.`);
      }
      save({ ...data, notes: data.notes.filter((note) => note.id !== id) });
    },
    clear: () => {
      const data = current();
      // Nothing to clear: do not create a file just to record that.
      if (data.notes.length === 0) return;
      save({ ...data, notes: [] });
    },
  };
}

/** The file to persist to, or undefined when there is none or it would land in the workspace. */
function persistentFile(options: NotesStoreOptions, key: string): string | undefined {
  if (options.stateDirectory === undefined) return undefined;
  const thread = key === NOTES_NO_THREAD ? undefined : key;
  const file = notesFileFor(options.stateDirectory, options.workspace, thread);
  return isInside(options.workspace, file) ? undefined : file;
}
