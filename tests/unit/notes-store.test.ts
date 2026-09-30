import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createNotesStore, isInside, notesFileFor } from '../../src/sdk/notes-store';
import { NOTES_MAX_BYTES, NOTES_MAX_COUNT } from '../../src/sdk/notes-tool.constants';

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function directory(prefix: string): string {
  const made = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(made);
  return made;
}

function storeFor(state: string | undefined, workspace: string, thread: () => string | undefined) {
  return createNotesStore({ workspace, threadId: thread, stateDirectory: state });
}

describe('notes store', () => {
  it('adds, replaces, removes and clears, with ids that are never reused', () => {
    const store = storeFor(undefined, directory('ws-'), () => 't1');

    const first = store.add('one', undefined);
    const second = store.add('two', 'plan');
    store.remove(first.id);
    const third = store.add('three', undefined);
    store.replace(second.id, 'two again');

    expect(store.list().map((note) => [note.id, note.text, note.tag])).toEqual([
      [2, 'two again', 'plan'],
      [3, 'three', undefined],
    ]);
    expect(third.id).toBe(3);
    store.clear();
    expect(store.list()).toEqual([]);
    expect(store.add('four', undefined).id).toBe(4);
  });

  it('refuses to replace or remove a note that is not there', () => {
    const store = storeFor(undefined, directory('ws-'), () => 't1');

    expect(() => store.replace(9, 'x')).toThrow(/no note 9/u);
    expect(() => {
      store.remove(9);
    }).toThrow(/no note 9/u);
  });

  it('holds at most 200 notes', () => {
    const store = storeFor(undefined, directory('ws-'), () => 't1');
    for (let index = 0; index < NOTES_MAX_COUNT; index += 1) {
      store.add('n', undefined);
    }

    expect(() => store.add('one too many', undefined)).toThrow(/At most 200 notes/u);
    expect(store.list()).toHaveLength(NOTES_MAX_COUNT);
  });

  it('holds at most 64 KB and keeps what it had when a note does not fit', () => {
    const store = storeFor(undefined, directory('ws-'), () => 't1');
    const big = 'x'.repeat(2_000);
    let added = 0;
    while (added < 40) {
      try {
        store.add(big, undefined);
        added += 1;
      } catch (error) {
        expect((error as Error).message).toMatch(/Notes are full/u);
        break;
      }
    }

    expect(added).toBeGreaterThan(20);
    expect(added).toBeLessThan(40);
    expect(JSON.stringify(store.list()).length).toBeLessThanOrEqual(NOTES_MAX_BYTES);
    expect(store.list()).toHaveLength(added);
  });

  it('persists to the state directory and a new store reads it back', () => {
    const state = directory('state-');
    const workspace = directory('ws-');
    storeFor(state, workspace, () => 'thread-a').add('remember me', 'tag');

    const again = storeFor(state, workspace, () => 'thread-a');

    expect(again.list().map((note) => note.text)).toEqual(['remember me']);
    const file = notesFileFor(state, workspace, 'thread-a');
    expect(existsSync(file)).toBe(true);
    expect(readdirSync(path.dirname(file)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('treats a corrupt file as no notes and recovers on the next write', () => {
    const state = directory('state-');
    const workspace = directory('ws-');
    const store = storeFor(state, workspace, () => 'thread-a');
    store.add('old', undefined);
    const file = notesFileFor(state, workspace, 'thread-a');
    writeFileSync(file, '{not json');

    const fresh = storeFor(state, workspace, () => 'thread-a');

    expect(fresh.list()).toEqual([]);
    fresh.add('new', undefined);
    expect(JSON.parse(readFileSync(file, 'utf8')).notes).toHaveLength(1);
  });

  it('treats a file of the wrong shape as no notes', () => {
    const state = directory('state-');
    const workspace = directory('ws-');
    storeFor(state, workspace, () => 'thread-a').add('x', undefined);
    writeFileSync(notesFileFor(state, workspace, 'thread-a'), '{"notes":[{"id":"a"}]}');

    expect(storeFor(state, workspace, () => 'thread-a').list()).toEqual([]);
  });

  it('keeps each thread and each workspace apart', () => {
    const state = directory('state-');
    const workspace = directory('ws-');
    let thread = 'thread-a';
    const store = storeFor(state, workspace, () => thread);
    store.add('for a', undefined);

    thread = 'thread-b';
    expect(store.list()).toEqual([]);
    store.add('for b', undefined);
    thread = 'thread-a';

    expect(store.list().map((note) => note.text)).toEqual(['for a']);
    expect(storeFor(state, directory('other-'), () => 'thread-a').list()).toEqual([]);
  });

  it('never writes inside the workspace, even when the state directory is there', () => {
    const workspace = directory('ws-');
    const store = storeFor(path.join(workspace, '.state'), workspace, () => 'thread-a');

    store.add('still remembered in memory', undefined);

    expect(store.list()).toHaveLength(1);
    expect(existsSync(path.join(workspace, '.state'))).toBe(false);
    expect(readdirSync(workspace)).toEqual([]);
  });

  it('knows what is inside a directory', () => {
    expect(isInside('/a/b', '/a/b/c/d.json')).toBe(true);
    expect(isInside('/a/b', '/a/bc/d.json')).toBe(false);
    expect(isInside('/a/b', '/a/x.json')).toBe(false);
  });
});
