import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeWorkspaceTool } from '../../src/sdk/workspace-tool-executor';
import { offeredDefinitions, toolCategory } from '../../src/sdk/workspace-toolkit';

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'claw-edit-'));
  created.push(directory);
  return directory;
}

function tool(root: string) {
  return (operation: string, args: Record<string, unknown> = {}): Record<string, unknown> =>
    executeWorkspaceTool(
      { toolName: 'workspace.file', operation, arguments: args },
      { workspace: root, allowedExecutables: ['node'] },
    ) as Record<string, unknown>;
}

function put(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function text(root: string, relative: string): string {
  return readFileSync(path.join(root, relative), 'utf8');
}

describe('workspace.file create', () => {
  it('writes, creates folders, and names a missing path', () => {
    const root = workspace();

    expect(tool(root)('create', { path: 'a/b/c.txt', content: 'hi' })).toEqual({
      written: 'a/b/c.txt',
    });
    expect(text(root, 'a/b/c.txt')).toBe('hi');
    expect(() => tool(root)('create', { content: 'x' })).toThrow(/requires a "path"/u);
  });
});

describe('workspace.file update', () => {
  it('replaces one exact occurrence', () => {
    const root = workspace();
    put(root, 'a.ts', 'const a = 1;\nconst b = 2;\n');

    expect(
      tool(root)('update', { path: 'a.ts', oldText: 'const b = 2;', newText: 'const b = 3;' }),
    ).toEqual({
      path: 'a.ts',
      replacements: 1,
    });
    expect(text(root, 'a.ts')).toBe('const a = 1;\nconst b = 3;\n');
  });

  it('allows an empty newText to delete text and does not treat $ as a pattern', () => {
    const root = workspace();
    put(root, 'a.txt', 'keep REMOVE keep');
    tool(root)('update', { path: 'a.txt', oldText: ' REMOVE', newText: '' });
    tool(root)('update', { path: 'a.txt', oldText: 'keep keep', newText: 'cost $& $1' });

    expect(text(root, 'a.txt')).toBe('cost $& $1');
  });

  it('fails clearly when oldText is missing', () => {
    const root = workspace();
    put(root, 'a.txt', 'abc');

    expect(() => tool(root)('update', { path: 'a.txt', oldText: 'zzz', newText: 'y' })).toThrow(
      /"oldText" was not found in a\.txt/u,
    );
    expect(text(root, 'a.txt')).toBe('abc');
  });

  it('fails when oldText is ambiguous and leaves the file alone', () => {
    const root = workspace();
    put(root, 'a.txt', 'x\nx\nx\n');

    expect(() => tool(root)('update', { path: 'a.txt', oldText: 'x', newText: 'y' })).toThrow(
      /matches 3 times in a\.txt but 1 was expected/u,
    );
    expect(text(root, 'a.txt')).toBe('x\nx\nx\n');
  });

  it('honours expectedCount and replaceAll', () => {
    const root = workspace();
    put(root, 'a.txt', 'x x x');
    const run = tool(root);

    expect(() =>
      run('update', { path: 'a.txt', oldText: 'x', newText: 'y', expectedCount: 2 }),
    ).toThrow(/3 times/u);
    expect(
      run('update', {
        path: 'a.txt',
        oldText: 'x',
        newText: 'y',
        expectedCount: 3,
        replaceAll: true,
      }),
    ).toMatchObject({
      replacements: 3,
    });
    expect(text(root, 'a.txt')).toBe('y y y');
    expect(() =>
      run('update', {
        path: 'a.txt',
        oldText: 'y',
        newText: 'z',
        replaceAll: true,
        expectedCount: 2,
      }),
    ).toThrow(/3 times/u);
    expect(
      run('update', { path: 'a.txt', oldText: 'y', newText: 'z', replaceAll: true }),
    ).toMatchObject({ replacements: 3 });
  });

  it('preserves CRLF when the model sends LF text', () => {
    const root = workspace();
    put(root, 'w.txt', 'one\r\ntwo\r\nthree\r\n');

    tool(root)('update', { path: 'w.txt', oldText: 'one\ntwo', newText: 'uno\ndos\ndos-b' });

    expect(text(root, 'w.txt')).toBe('uno\r\ndos\r\ndos-b\r\nthree\r\n');
  });

  it('keeps LF files LF and leaves a mixed file exactly as written', () => {
    const root = workspace();
    put(root, 'l.txt', 'a\nb\n');
    put(root, 'm.txt', 'a\r\nb\nc\n');

    tool(root)('update', { path: 'l.txt', oldText: 'a\nb', newText: 'x\ny' });
    tool(root)('update', { path: 'm.txt', oldText: 'b\nc', newText: 'B\nC' });

    expect(text(root, 'l.txt')).toBe('x\ny\n');
    expect(text(root, 'm.txt')).toBe('a\r\nB\nC\n');
  });

  it('names the argument for every misuse', () => {
    const root = workspace();
    put(root, 'a.txt', 'abc');
    put(root, 'dir/x', 'x');
    const run = tool(root);

    expect(() => run('update', { oldText: 'a', newText: 'b' })).toThrow(/requires a "path"/u);
    expect(() => run('update', { path: 'a.txt', newText: 'b' })).toThrow(/"oldText"/u);
    expect(() => run('update', { path: 'a.txt', oldText: 'a' })).toThrow(/"newText"/u);
    expect(() => run('update', { path: 'nope', oldText: 'a', newText: 'b' })).toThrow(
      /"path" nope does not exist/u,
    );
    expect(() => run('update', { path: 'dir', oldText: 'a', newText: 'b' })).toThrow(
      /is not a file/u,
    );
    expect(() =>
      run('update', { path: 'a.txt', oldText: 'a', newText: 'b', expectedCount: 0 }),
    ).toThrow(/"expectedCount"/u);
  });
});

describe('workspace.file delete and rename', () => {
  it('deletes a file, refuses a folder, the root and a missing path', () => {
    const root = workspace();
    put(root, 'a.txt', 'x');
    put(root, 'dir/b.txt', 'x');
    const run = tool(root);

    expect(run('delete', { path: 'a.txt' })).toEqual({ deleted: 'a.txt' });
    expect(existsSync(path.join(root, 'a.txt'))).toBe(false);
    expect(() => run('delete', { path: 'dir' })).toThrow(/is not a file/u);
    expect(() => run('delete', { path: '.' })).toThrow(/workspace root/u);
    expect(() => run('delete', { path: 'gone.txt' })).toThrow(/"path" gone\.txt does not exist/u);
    expect(existsSync(path.join(root, 'dir/b.txt'))).toBe(true);
  });

  it('renames a file into a new folder and refuses an existing target', () => {
    const root = workspace();
    put(root, 'a.txt', 'A');
    put(root, 'b.txt', 'B');
    const run = tool(root);

    expect(run('rename', { path: 'a.txt', to: 'new/dir/a2.txt' })).toEqual({
      renamed: 'a.txt',
      to: 'new/dir/a2.txt',
    });
    expect(text(root, 'new/dir/a2.txt')).toBe('A');
    expect(() => run('rename', { path: 'new/dir/a2.txt', to: 'b.txt' })).toThrow(
      /"to" b\.txt already exists/u,
    );
    expect(() => run('rename', { path: 'gone', to: 'x' })).toThrow(/"path" gone does not exist/u);
    expect(() => run('rename', { path: 'b.txt' })).toThrow(/requires a non-empty "to"/u);
    expect(() => run('rename', { path: '.', to: 'x' })).toThrow(/workspace root/u);
  });
});

describe('workspace.file definition', () => {
  it('categorises every operation and offers reads without writes', () => {
    const call = (operation: string) => ({ toolName: 'workspace.file', operation, arguments: {} });

    for (const operation of ['read', 'list', 'glob', 'search', 'stat']) {
      expect(toolCategory(call(operation))).toBe('read');
    }
    for (const operation of ['create', 'update', 'delete', 'rename']) {
      expect(toolCategory(call(operation))).toBe('write');
    }
    const offered = offeredDefinitions(['read']) as { operations: string[] }[];

    expect(offered[0]?.operations).toEqual(['read', 'list', 'glob', 'search', 'stat']);
  });

  it('declares a strict schema with bounds on every argument', () => {
    const [file] = offeredDefinitions(['read', 'write']) as {
      inputSchema: { additionalProperties: boolean; properties: Record<string, { type: string }> };
    }[];
    const properties = file?.inputSchema.properties ?? {};

    expect(file?.inputSchema.additionalProperties).toBe(false);
    for (const name of ['startLine', 'endLine', 'offset', 'limit', 'depth', 'expectedCount']) {
      expect(properties[name]).toMatchObject({
        type: 'integer',
        minimum: expect.any(Number),
        maximum: expect.any(Number),
      });
    }
    for (const name of [
      'pattern',
      'query',
      'regex',
      'include',
      'oldText',
      'newText',
      'to',
      'path',
    ]) {
      expect(properties[name]).toMatchObject({ type: 'string', maxLength: expect.any(Number) });
    }
    expect(properties.recursive?.type).toBe('boolean');
    expect(properties.replaceAll?.type).toBe('boolean');
    expect(properties.caseSensitive?.type).toBe('boolean');
  });
});
