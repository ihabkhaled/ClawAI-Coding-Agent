import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanUpRepositories,
  call,
  git,
  put,
  scopedRepository,
  scopeOf,
} from './write-scope.helpers';

import type { WriteScopeViolation } from '../../src/sdk/write-scope.types';

afterEach(cleanUpRepositories);

const OUTSIDE = /is outside the write scope\. You may only change: src\/\*\*\./u;

describe('workspace.file under a write scope', () => {
  it('creates, updates, deletes and renames inside the scope', async () => {
    const root = scopedRepository();
    const scope = scopeOf(['src/**']);

    await call(root, scope, 'workspace.file', 'create', { path: 'src/new.ts', content: 'n\n' });
    await call(root, scope, 'workspace.file', 'update', {
      path: 'src/a.ts',
      oldText: 'a',
      newText: 'b',
    });
    await call(root, scope, 'workspace.file', 'rename', { path: 'src/new.ts', to: 'src/n2.ts' });
    await call(root, scope, 'workspace.file', 'delete', { path: 'src/n2.ts' });

    expect(readFileSync(path.join(root, 'src/a.ts'), 'utf8')).toBe('b\n');
    expect(existsSync(path.join(root, 'src/n2.ts'))).toBe(false);
  });

  it.each([
    ['create', { path: 'other2.txt', content: 'x' }],
    ['update', { path: 'other.txt', oldText: 'o', newText: 'p' }],
    ['delete', { path: 'other.txt' }],
    ['rename', { path: 'other.txt', to: 'src/other.txt' }],
    ['rename', { path: 'src/a.ts', to: 'docs/a.ts' }],
  ])('refuses %s %j outside the scope, touching nothing', async (operation, args) => {
    const root = scopedRepository();
    const seen: WriteScopeViolation[] = [];

    await expect(
      call(root, scopeOf(['src/**'], [], seen), 'workspace.file', operation, args),
    ).rejects.toThrow(
      new RegExp(`workspace\\.file ${operation} refused: ".+" ${OUTSIDE.source}`, 'u'),
    );

    expect(git(root, 'status', '--porcelain')).toBe('');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.tool).toBe('workspace.file');
  });

  it('refuses a rename whose destination alone is outside', async () => {
    const root = scopedRepository();

    await expect(
      call(root, scopeOf(['src/**']), 'workspace.file', 'rename', {
        path: 'src/a.ts',
        to: 'elsewhere/a.ts',
      }),
    ).rejects.toThrow('"elsewhere/a.ts" is outside');
    expect(existsSync(path.join(root, 'src/a.ts'))).toBe(true);
  });

  it('refuses a deny match inside the scope, and says what is denied', async () => {
    const root = scopedRepository();
    put(root, 'src/secret/k.ts');

    await expect(
      call(root, scopeOf(['src/**'], ['src/secret/**']), 'workspace.file', 'update', {
        path: 'src/secret/k.ts',
        oldText: 'x',
        newText: 'y',
      }),
    ).rejects.toThrow('refused: "src/secret/k.ts" is outside the write scope');
  });

  it('refuses .git even under a scope that names everything', async () => {
    const root = scopedRepository();

    await expect(
      call(root, scopeOf(['**']), 'workspace.file', 'create', {
        path: '.git/hooks/post-commit',
        content: 'x',
      }),
    ).rejects.toThrow('refused');
  });

  it('never restricts reads', async () => {
    const root = scopedRepository();
    const scope = scopeOf(['src/**']);

    const read = await call(root, scope, 'workspace.file', 'read', { path: 'other.txt' });
    const listed = await call(root, scope, 'workspace.file', 'list', { path: '.' });

    expect(read.content).toContain('o');
    expect(JSON.stringify(listed)).toContain('other.txt');
  });

  it('refuses a write that lands outside the scope through a symbolic link', async () => {
    const root = scopedRepository();
    try {
      symlinkSync(path.join(root, 'docs'), path.join(root, 'src', 'link'), 'junction');
    } catch {
      return;
    }

    await expect(
      call(root, scopeOf(['src/**']), 'workspace.file', 'create', {
        path: 'src/link/new.md',
        content: 'x',
      }),
    ).rejects.toThrow('refused');
    expect(existsSync(path.join(root, 'docs', 'new.md'))).toBe(false);
  });

  it('does not restrict anything when there is no scope', async () => {
    const root = scopedRepository();

    await call(root, undefined, 'workspace.file', 'create', { path: 'anywhere.txt', content: 'x' });

    expect(existsSync(path.join(root, 'anywhere.txt'))).toBe(true);
  });
});

describe('workspace.git under a write scope', () => {
  it.each(['add', 'unstage', 'restore'])(
    'refuses %s of a path outside the scope',
    async (operation) => {
      const root = scopedRepository();
      put(root, 'other.txt', 'changed\n');
      const seen: WriteScopeViolation[] = [];

      await expect(
        call(root, scopeOf(['src/**'], [], seen), 'workspace.git', operation, {
          paths: ['src/a.ts', 'other.txt'],
        }),
      ).rejects.toThrow(
        `workspace.git ${operation} refused: "other.txt" is outside the write scope.`,
      );

      expect(git(root, 'status', '--porcelain')).toBe('M other.txt');
      expect(seen[0]).toEqual({ tool: 'workspace.git', paths: ['other.txt'] });
    },
  );

  it('adds, unstages and restores paths inside the scope', async () => {
    const root = scopedRepository();
    const scope = scopeOf(['src/**']);
    put(root, 'src/a.ts', 'changed\n');

    await call(root, scope, 'workspace.git', 'add', { paths: ['src/a.ts'] });
    expect(git(root, 'status', '--porcelain')).toBe('M  src/a.ts');
    await call(root, scope, 'workspace.git', 'unstage', { paths: ['src/a.ts'] });
    await call(root, scope, 'workspace.git', 'restore', { paths: ['src/a.ts'] });

    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it('still refuses add of "." and "-A" with git\'s own message, scope or not', async () => {
    const root = scopedRepository();
    const scope = scopeOf(['src/**']);

    await expect(call(root, scope, 'workspace.git', 'add', { paths: ['.'] })).rejects.toThrow(
      'would match everything',
    );
    await expect(call(root, scope, 'workspace.git', 'add', { paths: ['-A'] })).rejects.toThrow(
      'is a flag',
    );
  });

  it('refuses a commit whose staged set reaches outside the scope, naming the paths', async () => {
    const root = scopedRepository();
    put(root, 'src/a.ts', 'changed\n');
    put(root, 'other.txt', 'changed\n');
    git(root, 'add', 'src/a.ts', 'other.txt');
    const seen: WriteScopeViolation[] = [];
    const before = git(root, 'rev-parse', 'HEAD');

    await expect(
      call(root, scopeOf(['src/**'], [], seen), 'workspace.git', 'commit', { message: 'feat: x' }),
    ).rejects.toThrow('staged set has paths outside the write scope: other.txt');

    expect(git(root, 'rev-parse', 'HEAD')).toBe(before);
    expect(seen).toEqual([{ tool: 'workspace.git', paths: ['other.txt'] }]);
  });

  it('counts both ends of a staged rename', async () => {
    const root = scopedRepository();
    git(root, 'mv', 'other.txt', 'src/other.txt');

    await expect(
      call(root, scopeOf(['src/**']), 'workspace.git', 'commit', { message: 'feat: x' }),
    ).rejects.toThrow('paths outside the write scope: other.txt');
  });

  it('commits when everything staged is inside the scope', async () => {
    const root = scopedRepository();
    put(root, 'src/a.ts', 'changed\n');
    git(root, 'add', 'src/a.ts');

    const result = await call(root, scopeOf(['src/**']), 'workspace.git', 'commit', {
      message: 'feat: x',
    });

    expect(result.committed).toBe(true);
  });

  it('does not check the staged set when there is no scope', async () => {
    const root = scopedRepository();
    put(root, 'other.txt', 'changed\n');
    git(root, 'add', 'other.txt');

    const result = await call(root, undefined, 'workspace.git', 'commit', { message: 'feat: x' });

    expect(result.committed).toBe(true);
  });
});
