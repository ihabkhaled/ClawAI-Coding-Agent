import { existsSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { workspaceToolkit } from '../../src/sdk/workspace-toolkit';
import { createWriteScope, pathInScope } from '../../src/sdk/write-scope';

import {
  call,
  cleanUpRepositories,
  git,
  put,
  scopedRepository,
  scopeOf,
} from './write-scope.helpers';

afterEach(cleanUpRepositories);

function need<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('no scope');
  return value;
}

describe('NTFS name forms', () => {
  const win = createWriteScope({ deny: ['README.md', 'src/secrets/**'] }, { platform: 'win32' });

  it.each([
    'README.md::$DATA',
    'README.md:stream',
    'README.md.',
    'README.md ',
    'readme.MD',
    'README.md. .',
    String.raw`src\secrets\k.txt::$DATA`,
    'SRC/secrets./k.txt',
  ])('denies %s on win32', (name) => {
    expect(pathInScope(need(win), name)).toBe(false);
  });

  it('keeps an ordinary name allowed', () => {
    expect(pathInScope(need(win), 'READMEX.md')).toBe(true);
  });

  it('does not rewrite names on linux', () => {
    const linux = createWriteScope({ deny: ['README.md'] }, { platform: 'linux' });
    expect(pathInScope(need(linux), 'README.md::$DATA')).toBe(true);
  });
});

describe('.git without any scope', () => {
  it('is denied to workspace.file when write is granted', async () => {
    const root = scopedRepository();
    const toolkit = workspaceToolkit(root, { allow: ['read', 'write'] });
    expect(() =>
      toolkit.execute({
        toolName: 'workspace.file',
        operation: 'create',
        arguments: { path: '.git/hooks/pre-commit', content: 'x' },
      }),
    ).toThrow(/refused.*\.git/u);
    expect(existsSync(path.join(root, '.git/hooks/pre-commit'))).toBe(false);
    toolkit.dispose?.();
  });

  it('leaves ordinary writes alone', async () => {
    const root = scopedRepository();
    const toolkit = workspaceToolkit(root, { allow: ['read', 'write'] });
    await Promise.resolve(
      toolkit.execute({
        toolName: 'workspace.file',
        operation: 'create',
        arguments: { path: 'ok.txt', content: 'x' },
      }),
    );
    expect(existsSync(path.join(root, 'ok.txt'))).toBe(true);
    toolkit.dispose?.();
  });
});

describe('a deny glob also protects its directory', () => {
  it('refuses renaming and deleting the directory and its ancestors', async () => {
    const root = scopedRepository();
    put(root, 'src/secrets/k.txt');
    const scope = scopeOf([], ['src/secrets/**']);
    await expect(
      call(root, scope, 'workspace.file', 'rename', { path: 'src/secrets', to: 'src/moved' }),
    ).rejects.toThrow(/protects/u);
    await expect(
      call(root, scope, 'workspace.file', 'rename', { path: 'src', to: 'lib' }),
    ).rejects.toThrow(/protects/u);
    await expect(
      call(root, scope, 'workspace.file', 'delete', { path: 'src/secrets' }),
    ).rejects.toThrow(/protects/u);
    expect(existsSync(path.join(root, 'src/secrets/k.txt'))).toBe(true);
  });

  it('still renames an unrelated file', async () => {
    const root = scopedRepository();
    const scope = scopeOf([], ['src/secrets/**']);
    await call(root, scope, 'workspace.file', 'rename', { path: 'other.txt', to: 'other2.txt' });
    expect(existsSync(path.join(root, 'other2.txt'))).toBe(true);
  });
});

describe('git restore of a directory', () => {
  it('is refused when it would discard a denied file', async () => {
    const root = scopedRepository();
    put(root, 'src/keep.env', 'k\n');
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'env');
    put(root, 'src/keep.env', 'changed\n');
    const scope = scopeOf([], ['**/*.env']);
    await expect(call(root, scope, 'workspace.git', 'restore', { paths: ['src'] })).rejects.toThrow(
      /covers paths outside the write scope/u,
    );
    await call(root, scope, 'workspace.git', 'restore', { paths: ['src/a.ts'] });
  });
});
