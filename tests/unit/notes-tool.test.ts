import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createNotesStore, notesFileFor } from '../../src/sdk/notes-store';
import { createNotesTool, notesSection } from '../../src/sdk/notes-tool';
import {
  NOTE_MAX_TAG_CHARS,
  NOTE_MAX_TEXT_CHARS,
  NOTES_PROMPT_MAX_CHARS,
  NOTES_READ_MAX_CHARS,
} from '../../src/sdk/notes-tool.constants';
import { toolCategory, workspaceToolkit } from '../../src/sdk/workspace-toolkit';

import type { NoteAddedInfo } from '../../src/sdk/notes-tool.types';

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function directory(prefix: string): string {
  const made = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(made);
  return made;
}

function fresh(state?: string, workspace = directory('ws-')) {
  const store = createNotesStore({ workspace, threadId: () => 't1', stateDirectory: state });
  const added: NoteAddedInfo[] = [];
  return { store, added, tool: createNotesTool(store, (info) => added.push(info)), workspace };
}

describe('workspace.notes operations', () => {
  it('adds, reads numbered with the newest last, replaces, removes and clears', () => {
    const { tool } = fresh();

    expect(tool.execute('add', { text: 'first' })).toMatch(/Note 1 saved/u);
    tool.execute('add', { text: 'second', tag: 'plan' });
    expect(tool.execute('read', {})).toBe('1. first\n2. [plan] second');
    expect(tool.execute('replace', { id: 1, text: 'first v2' })).toBe('Note 1 replaced.');
    expect(tool.execute('remove', { id: 2 })).toBe('Note 2 removed.');
    expect(tool.execute('read', {})).toBe('1. first v2');
    expect(tool.execute('clear', {})).toBe('All notes cleared.');
    expect(tool.execute('read', {})).toBe('No notes.');
  });

  it('filters by tag and by query, ignoring case', () => {
    const { tool } = fresh();
    tool.execute('add', { text: 'Routes live in src/app', tag: 'Layout' });
    tool.execute('add', { text: 'gate: lint failed once', tag: 'gates' });

    expect(tool.execute('read', { tag: 'layout' })).toBe('1. [Layout] Routes live in src/app');
    expect(tool.execute('read', { query: 'LINT' })).toBe('2. [gates] gate: lint failed once');
    expect(tool.execute('read', { tag: 'gates', query: 'routes' })).toBe('No notes.');
  });

  it('validates its arguments with messages the model can act on', () => {
    const { tool } = fresh();

    expect(() => tool.execute('add', {})).toThrow(/non-empty "text"/u);
    expect(() => tool.execute('add', { text: '   ' })).toThrow(/non-empty "text"/u);
    expect(() => tool.execute('add', { text: 'x'.repeat(NOTE_MAX_TEXT_CHARS + 1) })).toThrow(
      /at most 2000/u,
    );
    expect(() =>
      tool.execute('add', { text: 'x', tag: 't'.repeat(NOTE_MAX_TAG_CHARS + 1) }),
    ).toThrow(/at most 32/u);
    expect(() => tool.execute('remove', {})).toThrow(/"id"/u);
    expect(() => tool.execute('replace', { id: 1.5, text: 'x' })).toThrow(/"id"/u);
    expect(() => tool.execute('remove', { id: 5 })).toThrow(/no note 5/u);
    expect(() => tool.execute('explode', {})).toThrow(/Unsupported operation/u);
  });

  it('accepts a note of exactly the longest text', () => {
    const { tool, store } = fresh();

    tool.execute('add', { text: 'y'.repeat(NOTE_MAX_TEXT_CHARS) });

    expect(store.list()[0]?.text).toHaveLength(NOTE_MAX_TEXT_CHARS);
  });

  it('returns at most 24 000 characters, leaving out the oldest first', () => {
    const { tool, store } = fresh();
    for (let index = 0; index < 20; index += 1)
      store.add(`${String(index)}:${'z'.repeat(1_900)}`, undefined);

    const text = tool.execute('read', {});

    expect(text.length).toBeLessThanOrEqual(NOTES_READ_MAX_CHARS);
    expect(text).toMatch(/^\(\d+ older note\(s\) left out/u);
    expect(text).toContain('20. 19:');
    expect(text).not.toContain('1. 0:');
  });

  it('redacts secrets before they are stored or persisted', () => {
    const state = directory('state-');
    const { tool, store, workspace } = fresh(state);

    tool.execute('add', {
      text: 'use Authorization: Bearer abcdef123456789 for the api',
      tag: 'api_key=hunter2',
    });
    tool.execute('add', { text: 'ok' });
    tool.execute('replace', { id: 2, text: 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwx' });

    const kept = JSON.stringify(store.list());
    expect(kept).not.toContain('abcdef123456789');
    expect(kept).not.toContain('hunter2');
    expect(kept).not.toContain('ghp_abcdefghijklmnop');
    const file = readFileSync(notesFileFor(state, workspace, 't1'), 'utf8');
    expect(file).not.toContain('abcdef123456789');
    expect(file).not.toContain('ghp_abcdefghijklmnop');
  });

  it('reports each added note by id, tag and length, never its text', () => {
    const { tool, added } = fresh();

    tool.execute('add', { text: 'secret plan', tag: 'plan' });
    tool.execute('add', { text: 'abc' });
    tool.execute('replace', { id: 2, text: 'abcd' });

    expect(added).toEqual([
      { id: 1, tag: 'plan', chars: 11 },
      { id: 2, chars: 3 },
    ]);
    expect(JSON.stringify(added)).not.toContain('secret plan');
  });
});

describe('the prompt section', () => {
  it('is empty without notes and carries them under the heading otherwise', () => {
    const { tool, store } = fresh();
    expect(notesSection(store)).toBe('');

    tool.execute('add', { text: 'remember X' });

    expect(notesSection(store)).toBe('Your notes so far:\n1. remember X');
  });

  it('is capped at 8 KB', () => {
    const { store } = fresh();
    for (let index = 0; index < 10; index += 1) store.add('q'.repeat(1_500), undefined);

    const section = notesSection(store);

    expect(section.length).toBeLessThanOrEqual(NOTES_PROMPT_MAX_CHARS + 60);
    expect(section).toContain('older note(s) left out');
  });
});

describe('the notes tool in the toolkit', () => {
  it('is a read operation, offered with only the read grant, and runs without a store given', async () => {
    const toolkit = workspaceToolkit(directory('ws-'), { allow: ['read'] });
    const call = { toolName: 'workspace.notes', operation: 'add', arguments: { text: 'hi' } };

    expect(toolCategory(call)).toBe('read');
    expect(toolkit.definitions.map((entry) => (entry as { name: string }).name)).toContain(
      'workspace.notes',
    );
    expect(await toolkit.authorize?.(call)).toBe(true);
    expect(await toolkit.execute(call)).toEqual({ value: expect.stringMatching(/Note 1 saved/u) });
    expect(await toolkit.execute({ ...call, operation: 'read', arguments: {} })).toEqual({
      value: '1. hi',
    });
  });

  it('teaches the model to write things down before they are condensed', () => {
    const toolkit = workspaceToolkit(directory('ws-'), { allow: ['read'] });
    const definition = toolkit.definitions.find(
      (entry) => (entry as { name: string }).name === 'workspace.notes',
    ) as { description: string };

    expect(definition.description).toContain('earlier tool results get condensed');
    expect(definition.description).toContain('read to recall instead of re-reading files');
  });

  it('is not offered when the read grant is withheld', () => {
    const toolkit = workspaceToolkit(directory('ws-'), { allow: ['git'] });

    expect(toolkit.definitions.map((entry) => (entry as { name: string }).name)).not.toContain(
      'workspace.notes',
    );
  });
});
