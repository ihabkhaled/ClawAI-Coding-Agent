import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { guardToolResult } from '../../src/sdk/tool-result-guard';
import { executeWorkspaceTool } from '../../src/sdk/workspace-tool-executor';

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'claw-search-'));
  created.push(directory);
  return directory;
}

function tool(root: string) {
  return async (
    operation: string,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> =>
    (await executeWorkspaceTool(
      { toolName: 'workspace.file', operation, arguments: args },
      { workspace: root, allowedExecutables: ['node'] },
    )) as Record<string, unknown>;
}

function put(root: string, relative: string, content: string | Buffer): void {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

describe('workspace.file glob', () => {
  it('matches ** across folders, names at any depth, and braces', async () => {
    const root = workspace();
    put(root, 'a.ts', 'x');
    put(root, 'src/b.ts', 'x');
    put(root, 'src/deep/c.tsx', 'x');
    put(root, 'src/d.md', 'x');
    put(root, 'node_modules/e.ts', 'x');
    const run = tool(root);

    expect((await run('glob', { pattern: '**/*.ts' })).paths).toEqual(['a.ts', 'src/b.ts']);
    expect((await run('glob', { pattern: '*.ts' })).paths).toEqual(['a.ts', 'src/b.ts']);
    expect((await run('glob', { pattern: 'src/**/*.{ts,tsx}' })).paths).toEqual([
      'src/b.ts',
      'src/deep/c.tsx',
    ]);
    expect((await run('glob', { pattern: '**/*.ts', path: 'src' })).paths).toEqual(['src/b.ts']);
    expect((await run('glob', { pattern: '*.rs' })).paths).toEqual([]);
  });

  it('caps at 500 paths and flags truncation', async () => {
    const root = workspace();
    for (let index = 0; index < 520; index += 1) put(root, `d/f${String(index)}.txt`, 'x');

    const result = await tool(root)('glob', { pattern: '**/*.txt' });

    expect(result.paths as string[]).toHaveLength(500);
    expect(result.truncated).toBe(true);
  });

  it('names the argument when the pattern is missing or too long', async () => {
    const root = workspace();

    await expect(tool(root)('glob', {})).rejects.toThrow(/requires a non-empty "pattern"/u);
    await expect(tool(root)('glob', { pattern: 'a'.repeat(301) })).rejects.toThrow(
      /"pattern" must be 1 to 300/u,
    );
    await expect(tool(root)('glob', { pattern: '*', path: 'nope' })).rejects.toThrow(
      /"path" nope does not exist/u,
    );
  });
});

describe('workspace.file search', () => {
  it('finds a literal, case-insensitively by default, with path, line and text', async () => {
    const root = workspace();
    put(root, 'src/a.ts', 'const a = 1;\nconst Needle = 2;\n');
    put(root, 'b.ts', 'needle here\r\n');

    const result = await tool(root)('search', { query: 'needle' });

    expect(result.matches).toEqual([
      { path: 'b.ts', line: 1, text: 'needle here' },
      { path: 'src/a.ts', line: 2, text: 'const Needle = 2;' },
    ]);
    expect(result.truncated).toBe(false);
  });

  it('honours caseSensitive and treats a literal query as text, not a pattern', async () => {
    const root = workspace();
    put(root, 'a.txt', 'Needle\nneedle\na.b\naxb\n');
    const run = tool(root);

    expect(
      ((await run('search', { query: 'needle', caseSensitive: true })).matches as unknown[]).length,
    ).toBe(1);
    expect((await run('search', { query: 'a.b' })).matches).toEqual([
      { path: 'a.txt', line: 3, text: 'a.b' },
    ]);
  });

  it('runs a regular expression and rejects an invalid one by name', async () => {
    const root = workspace();
    put(root, 'a.txt', 'id=12\nid=x\nid=7\n');

    const found = (await tool(root)('search', { regex: 'id=\\d+' })).matches as { line: number }[];

    expect(found.map((match) => match.line)).toEqual([1, 3]);
    await expect(tool(root)('search', { regex: '(' })).rejects.toThrow(/"regex" is not a valid/u);
    await expect(tool(root)('search', {})).rejects.toThrow(/exactly one of "query"/u);
    await expect(tool(root)('search', { query: 'a', regex: 'b' })).rejects.toThrow(
      /exactly one of/u,
    );
  });

  it('limits to a path and an include glob', async () => {
    const root = workspace();
    put(root, 'src/a.ts', 'hit');
    put(root, 'src/a.md', 'hit');
    put(root, 'lib/b.ts', 'hit');
    const run = tool(root);

    expect(((await run('search', { query: 'hit', path: 'src' })).matches as unknown[]).length).toBe(
      2,
    );
    expect(
      (
        (await run('search', { query: 'hit', include: '**/*.ts' })).matches as { path: string }[]
      ).map((match) => match.path),
    ).toEqual(['lib/b.ts', 'src/a.ts']);
    expect((await run('search', { query: 'hit', path: 'src/a.md' })).matches).toEqual([
      { path: 'src/a.md', line: 1, text: 'hit' },
    ]);
  });

  it('skips binary files, files over 1 MB and the ignored folders', async () => {
    const root = workspace();
    put(root, 'bin.dat', Buffer.from('needle\0needle'));
    put(root, 'big.txt', `needle${' '.repeat(1024 * 1024)}`);
    put(root, 'node_modules/x.js', 'needle');
    put(root, '.git/config', 'needle');
    put(root, 'dist/o.js', 'needle');
    put(root, 'ok.txt', 'needle');

    const result = await tool(root)('search', { query: 'needle' });

    expect(result.matches).toEqual([{ path: 'ok.txt', line: 1, text: 'needle' }]);
    expect(result.filesSkipped).toBe(2);
    expect(result.filesScanned).toBe(1);
  });

  it('stops at 100 matches and cuts long lines to 200 characters', async () => {
    const root = workspace();
    put(root, 'a.txt', `${'needle '.repeat(500)}\n${'needle\n'.repeat(150)}`);

    const result = await tool(root)('search', { query: 'needle' });
    const matches = result.matches as { text: string }[];

    expect(matches).toHaveLength(100);
    expect(result.truncated).toBe(true);
    expect(Math.max(...matches.map((match) => match.text.length))).toBeLessThanOrEqual(200);
  });

  it('shows a window around a match that sits far along a long line', async () => {
    const root = workspace();
    put(root, 'a.txt', `${'-'.repeat(1000)}TARGET${'-'.repeat(1000)}`);

    const text = (
      (await tool(root)('search', { query: 'TARGET' })).matches as { text: string }[]
    )[0]?.text;

    expect(text).toContain('TARGET');
    expect(text?.length).toBeLessThanOrEqual(200);
  });
});

describe('tool result guard', () => {
  it('leaves a small result untouched', async () => {
    const small = { a: 'x', list: [1, 2] };

    expect(guardToolResult(small)).toBe(small);
    expect(guardToolResult(undefined)).toEqual({ value: null });
  });

  it('cuts oversized string fields and marks the result truncated', async () => {
    const guarded = guardToolResult({
      stdout: 'a'.repeat(200_000),
      stderr: 'b'.repeat(70_000),
      code: 0,
    }) as Record<string, unknown>;

    expect(JSON.stringify(guarded).length).toBeLessThanOrEqual(60_000);
    expect(guarded.truncated).toBe(true);
    expect(guarded.code).toBe(0);
    expect(String(guarded.stdout).endsWith('[truncated]')).toBe(true);
  });

  it('bounds a nested result and a bare string', async () => {
    const nested = guardToolResult({ items: [{ text: 'z'.repeat(90_000) }] });
    const bare = guardToolResult('q'.repeat(100_000));

    expect(JSON.stringify(nested).length).toBeLessThanOrEqual(60_000);
    expect(String(bare).length).toBeLessThanOrEqual(60_000);
  });

  it('replaces a result too large for field cutting with a preview', async () => {
    const many = { rows: Array.from({ length: 30_000 }, (_, index) => index) };

    const guarded = guardToolResult(many) as Record<string, unknown>;

    expect(guarded.truncated).toBe(true);
    expect(JSON.stringify(guarded).length).toBeLessThanOrEqual(60_000);
  });
});
