import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeWorkspaceTool } from '../../src/sdk/workspace-tool-executor';

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'claw-files-'));
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

function put(root: string, relative: string, content: string | Buffer): void {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function numbered(count: number, width = 20): string {
  return Array.from(
    { length: count },
    (_, index) => `line ${String(index + 1)} ${'x'.repeat(width)}`,
  ).join('\n');
}

describe('workspace.file read', () => {
  it('returns a small file whole with line metadata', () => {
    const root = workspace();
    put(root, 'a.txt', 'one\ntwo\nthree\n');

    expect(tool(root)('read', { path: 'a.txt' })).toEqual({
      path: 'a.txt',
      content: 'one\ntwo\nthree',
      startLine: 1,
      endLine: 3,
      totalLines: 3,
      truncated: false,
    });
  });

  it('cuts a huge file at a line boundary under 8000 characters and says how to continue', () => {
    const root = workspace();
    put(root, 'big.txt', numbered(20_000));

    const result = tool(root)('read', { path: 'big.txt' });

    expect(String(result.content).length).toBeLessThanOrEqual(8_000);
    expect(String(result.content).length).toBeGreaterThan(7_000);
    expect(result.truncated).toBe(true);
    expect(result.totalLines).toBe(20_000);
    expect(result.nextLine).toBe((result.endLine as number) + 1);
    expect(String(result.content).split('\n').at(-1)).toMatch(/^line \d+ x+$/u);
    expect(result.hint).toContain(`startLine=${String(result.nextLine)}`);
  });

  it('honours maxChars up to 48000 and refuses more', () => {
    const root = workspace();
    put(root, 'big.txt', numbered(20_000));

    const wide = tool(root)('read', { path: 'big.txt', maxChars: 48_000 });

    expect(String(wide.content).length).toBeGreaterThan(40_000);
    expect(String(wide.content).length).toBeLessThanOrEqual(48_000);
    expect(() => tool(root)('read', { path: 'big.txt', maxChars: 48_001 })).toThrow(/maxChars/u);
  });

  it('continues from nextLine to the end', () => {
    const root = workspace();
    put(root, 'big.txt', numbered(5_000));
    const first = tool(root)('read', { path: 'big.txt' });

    const second = tool(root)('read', { path: 'big.txt', startLine: first.nextLine });

    expect(second.startLine).toBe(first.nextLine);
    expect(String(second.content).split('\n')[0]).toBe(
      `line ${String(first.nextLine)} ${'x'.repeat(20)}`,
    );
  });

  it('reads an inclusive line range and an offset with a limit', () => {
    const root = workspace();
    put(root, 'a.txt', 'a\nb\nc\nd\ne\n');

    expect(tool(root)('read', { path: 'a.txt', startLine: 2, endLine: 3 })).toMatchObject({
      content: 'b\nc',
      startLine: 2,
      endLine: 3,
      nextLine: 4,
      truncated: false,
    });
    expect(tool(root)('read', { path: 'a.txt', offset: 3, limit: 5 })).toMatchObject({
      content: 'd\ne',
      startLine: 4,
      endLine: 5,
    });
  });

  it('cuts a single line longer than the ceiling and flags it', () => {
    const root = workspace();
    put(root, 'min.js', `${'y'.repeat(100_000)}\nnext`);

    const result = tool(root)('read', { path: 'min.js' });

    expect(String(result.content).length).toBeLessThanOrEqual(48_000);
    expect(result.truncated).toBe(true);
    expect(result.nextLine).toBe(2);
    expect(String(result.hint)).toContain('was cut');
  });

  it('returns an empty file as zero lines', () => {
    const root = workspace();
    put(root, 'empty.txt', '');

    expect(tool(root)('read', { path: 'empty.txt' })).toMatchObject({
      content: '',
      totalLines: 0,
      truncated: false,
    });
  });

  it('refuses a binary file with a note instead of garbage', () => {
    const root = workspace();
    put(root, 'image.png', Buffer.from([137, 80, 78, 71, 0, 1, 2, 3, 255]));

    expect(tool(root)('read', { path: 'image.png' })).toMatchObject({
      binary: true,
      content: '',
      size: 9,
    });
  });

  it('rejects a file over 5 MB with a hint to use ranges or search', () => {
    const root = workspace();
    put(root, 'huge.log', Buffer.alloc(5 * 1024 * 1024 + 1, 97));

    expect(() => tool(root)('read', { path: 'huge.log' })).toThrow(/search.*startLine/su);
  });

  it('names the argument on every misuse', () => {
    const root = workspace();
    put(root, 'a.txt', 'a\nb\n');
    put(root, 'dir/x.txt', 'x');

    expect(() => tool(root)('read', {})).toThrow(/requires a "path"/u);
    expect(() => tool(root)('read', { path: 'nope.txt' })).toThrow(
      /"path" nope\.txt does not exist/u,
    );
    expect(() => tool(root)('read', { path: 'dir' })).toThrow(/is a directory; use the list/u);
    expect(() => tool(root)('read', { path: 'a.txt', startLine: 9 })).toThrow(
      /"startLine" 9 is past/u,
    );
    expect(() => tool(root)('read', { path: 'a.txt', startLine: 2, endLine: 1 })).toThrow(
      /"endLine" 1 is before "startLine" 2/u,
    );
    expect(() => tool(root)('read', { path: 'a.txt', startLine: 'x' })).toThrow(
      /"startLine" must be an integer/u,
    );
  });
});

describe('workspace.file containment', () => {
  it('refuses traversal on every operation', async () => {
    const root = workspace();
    const run = tool(root);

    for (const operation of ['read', 'list', 'glob', 'search', 'stat', 'update', 'delete']) {
      await expect(async () =>
        run(operation, {
          path: '../outside',
          pattern: '*',
          query: 'a',
          oldText: 'a',
          newText: 'b',
        }),
      ).rejects.toThrow(/escapes the workspace/u);
    }
    expect(() => run('rename', { path: 'a', to: '../b' })).toThrow();
    expect(() => run('create', { path: '../x', content: 'a' })).toThrow(/escapes the workspace/u);
  });

  it('refuses a symbolic link and never follows one out of the workspace', async () => {
    const root = workspace();
    const outside = workspace();
    put(outside, 'secret.txt', 'top secret');
    put(root, 'real.txt', 'ok');
    try {
      symlinkSync(outside, path.join(root, 'link'), 'junction');
      symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'secret-link.txt'));
    } catch {
      return;
    }
    const run = tool(root);

    expect(() => run('read', { path: 'secret-link.txt' })).toThrow(/symbolic link/u);
    expect(() => run('read', { path: 'link/secret.txt' })).toThrow(/escapes the workspace/u);
    expect(JSON.stringify(await Promise.resolve(run('search', { query: 'secret' })))).not.toContain(
      'top secret',
    );
    expect(
      ((await Promise.resolve(run('glob', { pattern: '**/*.txt' }))).paths as string[]).sort(),
    ).toEqual(['real.txt']);
  });
});

describe('workspace.file stat', () => {
  it('reports a file, a folder and a missing path', () => {
    const root = workspace();
    put(root, 'dir/a.txt', 'hello');
    const run = tool(root);

    expect(run('stat', { path: 'dir/a.txt' })).toMatchObject({
      exists: true,
      type: 'file',
      size: 5,
    });
    expect(String(run('stat', { path: 'dir/a.txt' }).mtime)).toMatch(/^\d{4}-\d\d-\d\dT/u);
    expect(run('stat', { path: 'dir' })).toMatchObject({ exists: true, type: 'dir' });
    expect(run('stat', { path: 'gone' })).toEqual({ path: 'gone', exists: false });
    expect(() => run('stat', {})).toThrow(/requires a "path"/u);
  });
});

describe('workspace.file list', () => {
  it('lists the top level sorted, with types and sizes, skipping ignored folders', () => {
    const root = workspace();
    put(root, 'b.txt', 'bb');
    put(root, 'a.txt', 'a');
    put(root, 'src/x.ts', 'x');
    put(root, 'node_modules/p/i.js', 'x');
    put(root, '.git/HEAD', 'x');
    put(root, 'dist/o.js', 'x');
    put(root, 'coverage/c.json', 'x');
    put(root, '.next/n.js', 'x');

    expect(tool(root)('list')).toEqual({
      path: '.',
      entries: [
        { path: 'a.txt', type: 'file', size: 1 },
        { path: 'b.txt', type: 'file', size: 2 },
        { path: 'src', type: 'dir' },
      ],
      truncated: false,
    });
  });

  it('recurses to the requested depth and never past 4', () => {
    const root = workspace();
    put(root, 'a/b/c/d/e/f.txt', 'x');
    const run = tool(root);
    const paths = (args: Record<string, unknown>): string[] =>
      (run('list', args).entries as { path: string }[]).map((entry) => entry.path);

    expect(paths({ recursive: true })).toEqual(['a', 'a/b', 'a/b/c']);
    expect(paths({ depth: 2 })).toEqual(['a', 'a/b']);
    expect(paths({ recursive: true, depth: 50 })).toEqual(['a', 'a/b', 'a/b/c', 'a/b/c/d']);
    expect(paths({ path: 'a/b' })).toEqual(['a/b/c']);
  });

  it('caps at 400 entries and flags the truncation', () => {
    const root = workspace();
    for (let index = 0; index < 450; index += 1)
      put(root, `f${String(index).padStart(3, '0')}.txt`, 'x');

    const result = tool(root)('list');

    expect(result.entries as unknown[]).toHaveLength(400);
    expect(result.truncated).toBe(true);
    expect(String(result.hint)).toContain('400');
  });

  it('errors clearly for a file or a missing folder', () => {
    const root = workspace();
    put(root, 'a.txt', 'x');

    expect(() => tool(root)('list', { path: 'a.txt' })).toThrow(
      /"path" a\.txt is not a directory/u,
    );
    expect(() => tool(root)('list', { path: 'nope' })).toThrow(/"path" nope does not exist/u);
  });
});
