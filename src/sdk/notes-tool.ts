import { redactText } from '../core/redaction';

import {
  NOTE_MAX_TAG_CHARS,
  NOTE_MAX_TEXT_CHARS,
  NOTES_PROMPT_HEADING,
  NOTES_PROMPT_MAX_CHARS,
  NOTES_READ_MAX_CHARS,
} from './notes-tool.constants';

import type { AgentNote, NoteAddedInfo, NotesStore, NotesTool } from './notes-tool.types';

type ToolArguments = Readonly<Record<string, unknown>>;

/** The notes tool over one store; `onAdded` hears about each new note, without its text. */
export function createNotesTool(
  store: NotesStore,
  onAdded?: (info: NoteAddedInfo) => void,
): NotesTool {
  return {
    execute: (operation, args) => {
      if (operation === 'add') return add(store, args, onAdded);
      if (operation === 'read')
        return formatNotes(filtered(store.list(), args), NOTES_READ_MAX_CHARS);
      if (operation === 'replace') {
        const note = store.replace(requireId(args), requireText(args.text));
        return `Note ${String(note.id)} replaced.`;
      }
      if (operation === 'remove') {
        const id = requireId(args);
        store.remove(id);
        return `Note ${String(id)} removed.`;
      }
      if (operation === 'clear') {
        store.clear();
        return 'All notes cleared.';
      }
      throw new Error(`Unsupported operation ${operation}`);
    },
  };
}

function add(
  store: NotesStore,
  args: ToolArguments,
  onAdded: ((info: NoteAddedInfo) => void) | undefined,
): string {
  const note = store.add(requireText(args.text), optionalTag(args.tag));
  onAdded?.({
    id: note.id,
    ...(note.tag === undefined ? {} : { tag: note.tag }),
    chars: note.text.length,
  });
  return `Note ${String(note.id)} saved (${String(store.list().length)} in all).`;
}

/** The text, trimmed and redacted: a secret the model pasted is never written to disk. */
function requireText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0) throw new Error('workspace.notes needs a non-empty "text".');
  if (text.length > NOTE_MAX_TEXT_CHARS) {
    throw new Error(`A note holds at most ${String(NOTE_MAX_TEXT_CHARS)} characters.`);
  }
  return redactText(text);
}

function optionalTag(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const tag = typeof value === 'string' ? value.trim() : '';
  if (tag.length === 0) return undefined;
  if (tag.length > NOTE_MAX_TAG_CHARS) {
    throw new Error(`A tag holds at most ${String(NOTE_MAX_TAG_CHARS)} characters.`);
  }
  return redactText(tag);
}

function requireId(args: ToolArguments): number {
  const { id } = args;
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) {
    throw new Error('workspace.notes needs the note number as "id".');
  }
  return id;
}

function filtered(notes: readonly AgentNote[], args: ToolArguments): readonly AgentNote[] {
  const tag = typeof args.tag === 'string' ? args.tag.trim().toLowerCase() : '';
  const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
  return notes.filter(
    (note) =>
      (tag.length === 0 || note.tag?.toLowerCase() === tag) &&
      (query.length === 0 || `${note.tag ?? ''} ${note.text}`.toLowerCase().includes(query)),
  );
}

function line(note: AgentNote): string {
  return `${String(note.id)}. ${note.tag === undefined ? '' : `[${note.tag}] `}${note.text}`;
}

/** The notes as numbered lines, newest last; when they do not fit, the oldest are left out. */
export function formatNotes(notes: readonly AgentNote[], limit: number): string {
  if (notes.length === 0) return 'No notes.';
  const kept: string[] = [];
  let used = 0;
  for (const note of [...notes].reverse()) {
    const text = line(note);
    if (used + text.length + 1 > limit && kept.length > 0) break;
    kept.unshift(text.slice(0, limit));
    used += text.length + 1;
  }
  const omitted = notes.length - kept.length;
  const header =
    omitted > 0 ? [`(${String(omitted)} older note(s) left out; use tag or query)`] : [];
  return [...header, ...kept].join('\n');
}

/** The notes as a prompt section, or an empty string when there are none. */
export function notesSection(store: NotesStore): string {
  const notes = store.list();
  if (notes.length === 0) return '';
  return `${NOTES_PROMPT_HEADING}\n${formatNotes(notes, NOTES_PROMPT_MAX_CHARS)}`;
}

/** `prompt` with the notes appended, or unchanged when there are none. */
export function promptWithNotes(prompt: string, store: NotesStore): string {
  const section = notesSection(store);
  return section.length === 0 ? prompt : `${prompt}\n\n${section}`;
}
