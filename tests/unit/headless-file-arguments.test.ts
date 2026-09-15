import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { containedPath } from '../../src/core/workspace-containment';

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'claw-file-args-'));
  created.push(directory);
  return directory;
}

/**
 * The behaviour the live run exposed, isolated.
 *
 * A model called `create` with no `path`. The runner fell back to `.`, which
 * resolves to the workspace directory, and the write failed with EISDIR — a
 * message about directories that says nothing about a missing argument. The
 * model repeated the call until its budget ran out, and the run reported thirty
 * tool calls and no files.
 */
function requirePath(operation: string, args: Record<string, unknown>): string {
  const value = args.path;
  if (typeof value === 'string' && value.trim().length > 0) return value;
  const provided = Object.keys(args).join(', ');
  throw new Error(
    `workspace.file ${operation} requires a "path" argument. Received: ${provided.length > 0 ? provided : 'nothing'}.`,
  );
}

describe('workspace.file argument handling', () => {
  it('refuses a create that named no file', () => {
    expect(() => requirePath('create', {})).toThrow(/requires a "path" argument/u);
  });

  it('names the arguments it did receive, so the model can correct itself', () => {
    // The live failure sent exactly this: a wrapper key and no path.
    expect(() => requirePath('create', { transaction: {} })).toThrow(/Received: transaction/u);
  });

  it('says "nothing" rather than an empty list when no argument arrived at all', () => {
    expect(() => requirePath('read', {})).toThrow(/Received: nothing/u);
  });

  it('refuses a path that is present but blank', () => {
    expect(() => requirePath('create', { path: '   ' })).toThrow(/requires a "path"/u);
  });

  it('refuses a path that is not a string', () => {
    expect(() => requirePath('create', { path: 42 })).toThrow(/requires a "path"/u);
  });

  it('accepts an ordinary relative path', () => {
    expect(requirePath('create', { path: 'src/app.ts' })).toBe('src/app.ts');
  });

  it('never resolves a missing path to the workspace directory itself', () => {
    const root = workspace();

    // This is the resolution that produced EISDIR. It must never be reached for
    // a create, because writing to it targets the directory.
    expect(containedPath(root, '.')).toBe(root);
    expect(() => requirePath('create', {})).toThrow();
  });

  it('writes to the named file once a path is supplied', () => {
    const root = workspace();
    const relative = requirePath('create', { path: 'greet.js' });

    writeFileSync(containedPath(root, relative), 'module.exports = 1;', 'utf8');

    expect(readFileSync(path.join(root, 'greet.js'), 'utf8')).toBe('module.exports = 1;');
  });
});
