import { existsSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanUpRepositories,
  git,
  gitCall,
  installHook,
  makeRepository,
  writeIn,
} from './sdk-git-tools.helpers';

afterEach(cleanUpRepositories);

const staged = (repository: string): string => git(repository, 'diff', '--cached', '--name-only');

describe('add, unstage and restore', () => {
  it('stages only the named paths', async () => {
    const repo = makeRepository();
    writeIn(repo, 'a.txt', 'a');
    writeIn(repo, 'b.txt', 'b');

    const result = await gitCall(repo, 'add', { paths: ['a.txt'] });

    expect(result.exitCode).toBe(0);
    expect(staged(repo)).toBe('a.txt');
  });

  it('treats a bracketed name literally instead of as a glob', async () => {
    const repo = makeRepository();
    writeIn(repo, 'app/[id]/page.tsx', 'x');
    writeIn(repo, 'app/i/page.tsx', 'y');

    await gitCall(repo, 'add', { paths: ['app/[id]/page.tsx'] });

    expect(staged(repo)).toBe('app/[id]/page.tsx');
  });

  it.each(['.', './', '-A', '--all', '*', '**', ':/', ':(top)x', '', '..', '../outside.txt'])(
    'refuses %j and stages nothing',
    async (value) => {
      const repo = makeRepository();
      writeIn(repo, 'a.txt', 'a');

      await expect(gitCall(repo, 'add', { paths: [value] })).rejects.toThrow();

      expect(staged(repo)).toBe('');
    },
  );

  it('refuses an absolute path outside the workspace and an empty list', async () => {
    const repo = makeRepository();
    const outside = path.resolve(repo, '..', 'elsewhere.txt');

    await expect(gitCall(repo, 'add', { paths: [outside] })).rejects.toThrow(/escapes/u);
    await expect(gitCall(repo, 'add', { paths: [] })).rejects.toThrow(/non-empty/u);
    await expect(gitCall(repo, 'add', {})).rejects.toThrow(/paths/u);
  });

  it('unstages a path without touching the file', async () => {
    const repo = makeRepository();
    writeIn(repo, 'a.txt', 'a');
    await gitCall(repo, 'add', { paths: ['a.txt'] });

    await gitCall(repo, 'unstage', { paths: ['a.txt'] });

    expect(staged(repo)).toBe('');
    expect(existsSync(path.join(repo, 'a.txt'))).toBe(true);
  });

  it('restores a worktree file and refuses to restore everything', async () => {
    const repo = makeRepository();
    writeIn(repo, 'seed.txt', 'changed\n');

    await expect(gitCall(repo, 'restore', { paths: ['.'] })).rejects.toThrow(/everything/u);
    expect(git(repo, 'status', '--porcelain')).toContain('seed.txt');

    const result = await gitCall(repo, 'restore', { paths: ['seed.txt'] });

    expect(result.exitCode).toBe(0);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });
});

describe('commit', () => {
  it('commits what is staged and returns the hash', async () => {
    const repo = makeRepository();
    writeIn(repo, 'a.txt', 'a');
    await gitCall(repo, 'add', { paths: ['a.txt'] });

    const result = await gitCall(repo, 'commit', { message: 'feat: add a', body: 'Why.\nMore.' });

    expect(result).toMatchObject({
      exitCode: 0,
      committed: true,
      hash: git(repo, 'rev-parse', 'HEAD'),
    });
    expect(git(repo, 'log', '-1', '--format=%B')).toBe('feat: add a\n\nWhy.\nMore.');
  });

  it('runs the repository hooks and shows their output when they pass', async () => {
    const repo = makeRepository();
    installHook(repo, 'pre-commit', 'echo pre-commit-ran > hook-marker.txt\necho "lint ok" >&2');
    installHook(repo, 'commit-msg', 'echo "msg ok" >&2');
    writeIn(repo, 'a.txt', 'a');
    await gitCall(repo, 'add', { paths: ['a.txt'] });

    const result = await gitCall(repo, 'commit', { message: 'add a' });

    expect(result).toMatchObject({ committed: true, exitCode: 0 });
    expect(result.stderr).toContain('lint ok');
    expect(result.stderr).toContain('msg ok');
    expect(existsSync(path.join(repo, 'hook-marker.txt'))).toBe(true);
  });

  it('fails when a pre-commit hook fails, and leaves HEAD alone', async () => {
    const repo = makeRepository();
    installHook(
      repo,
      'pre-commit',
      'echo ran > hook-marker.txt\necho "lint failed: no" >&2\nexit 1',
    );
    writeIn(repo, 'a.txt', 'a');
    await gitCall(repo, 'add', { paths: ['a.txt'] });
    const before = git(repo, 'rev-parse', 'HEAD');

    const result = await gitCall(repo, 'commit', { message: 'add a' });

    expect(result.committed).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('lint failed: no');
    // The envelope calls any returned call succeeded: the result itself must say it was not.
    expect(result.ok).toBe(false);
    expect(String(result.failure)).toContain('Never bypass the hook');
    expect(existsSync(path.join(repo, 'hook-marker.txt'))).toBe(true);
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
  });

  it('fails when a commit-msg hook rejects the message', async () => {
    const repo = makeRepository();
    installHook(repo, 'commit-msg', 'echo "bad message" >&2\nexit 1');
    writeIn(repo, 'a.txt', 'a');
    await gitCall(repo, 'add', { paths: ['a.txt'] });

    const result = await gitCall(repo, 'commit', { message: 'add a' });

    expect(result).toMatchObject({ committed: false });
    expect(result.stderr).toContain('bad message');
  });

  it('cannot be told to skip hooks: nothing from the model becomes a flag', async () => {
    const repo = makeRepository();
    installHook(repo, 'pre-commit', 'echo blocked >&2\nexit 1');
    writeIn(repo, 'a.txt', 'a');
    await gitCall(repo, 'add', { paths: ['a.txt'] });

    const smuggled = await gitCall(repo, 'commit', {
      message: '--no-verify',
      noVerify: true,
      flags: ['--no-verify', '--no-gpg-sign'],
      arguments: ['--no-verify'],
    });

    expect(smuggled).toMatchObject({ committed: false });
    expect(smuggled.stderr).toContain('blocked');
    expect(git(repo, 'log', '--format=%s')).toBe('seed');
  });

  it('adds Co-Authored-By trailers after the body', async () => {
    const repo = makeRepository();
    writeIn(repo, 'a.txt', 'a');
    await gitCall(repo, 'add', { paths: ['a.txt'] });

    await gitCall(repo, 'commit', {
      message: 'add a',
      body: 'Body.',
      trailers: [
        'Co-Authored-By: Claude <noreply@anthropic.com>',
        'co-authored-by: Ann <ann@example.com>',
      ],
    });

    expect(git(repo, 'log', '-1', '--format=%B')).toBe(
      'add a\n\nBody.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nco-authored-by: Ann <ann@example.com>',
    );
  });

  it.each([
    ['another trailer', { trailers: ['Signed-off-by: A <a@b.co>'] }],
    ['a newline in a trailer', { trailers: ['Co-Authored-By: A <a@b.co>\nX: y'] }],
    ['an address-less trailer', { trailers: ['Co-Authored-By: nobody'] }],
    [
      'too many trailers',
      { trailers: Array.from({ length: 11 }, () => 'Co-Authored-By: A <a@b.co>') },
    ],
  ])('refuses %s', async (_name, extra) => {
    const repo = makeRepository();
    writeIn(repo, 'a.txt', 'a');
    await gitCall(repo, 'add', { paths: ['a.txt'] });

    await expect(gitCall(repo, 'commit', { message: 'x', ...extra })).rejects.toThrow(/trailer/u);
    expect(git(repo, 'log', '--format=%s')).toBe('seed');
  });

  it('enforces the 100 character header and one line, but not the conventional shape', async () => {
    const repo = makeRepository();
    writeIn(repo, 'a.txt', 'a');
    await gitCall(repo, 'add', { paths: ['a.txt'] });

    await expect(gitCall(repo, 'commit', { message: 'x'.repeat(101) })).rejects.toThrow(/100/u);
    await expect(gitCall(repo, 'commit', { message: 'one\ntwo' })).rejects.toThrow(/one line/u);
    await expect(gitCall(repo, 'commit', { message: '   ' })).rejects.toThrow(/requires/u);

    const ok = await gitCall(repo, 'commit', { message: 'x'.repeat(100) });
    expect(ok.committed).toBe(true);
  });

  it('reports nothing to commit as a result, not an exception', async () => {
    const repo = makeRepository();

    const result = await gitCall(repo, 'commit', { message: 'empty' });

    expect(result.committed).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });
});

describe('switch', () => {
  it('creates a branch and switches back', async () => {
    const repo = makeRepository();

    const made = await gitCall(repo, 'switch', { branch: 'feature/x', create: true });
    expect(made).toMatchObject({ exitCode: 0, created: true });
    expect(git(repo, 'branch', '--show-current')).toBe('feature/x');

    await gitCall(repo, 'switch', { branch: 'main' });
    expect(git(repo, 'branch', '--show-current')).toBe('main');
  });

  it.each([
    '--upload-pack=x',
    '-b',
    '-',
    '--detach',
    'a..b',
    'x.lock',
    'a b',
    'a:b',
    'a/',
    '',
    'a@{1}',
  ])('refuses the branch name %j', async (branch) => {
    const repo = makeRepository();

    await expect(gitCall(repo, 'switch', { branch, create: true })).rejects.toThrow();
    expect(git(repo, 'branch', '--list')).toBe('* main');
  });

  it('does not discard local changes to switch', async () => {
    const repo = makeRepository();
    await gitCall(repo, 'switch', { branch: 'other', create: true });
    writeIn(repo, 'seed.txt', 'other\n');
    git(repo, 'commit', '--quiet', '-am', 'other');
    writeIn(repo, 'seed.txt', 'dirty\n');

    const result = await gitCall(repo, 'switch', { branch: 'main' });

    expect(result.exitCode).not.toBe(0);
    expect(git(repo, 'branch', '--show-current')).toBe('other');
  });
});

describe('read operations', () => {
  it('shows HEAD, a path at a revision, and refuses a flag-shaped ref', async () => {
    const repo = makeRepository();

    const head = await gitCall(repo, 'show', {});
    expect(head.stdout).toContain('seed');

    const one = await gitCall(repo, 'show', { ref: 'HEAD', path: 'seed.txt' });
    expect(one.exitCode).toBe(0);

    await expect(gitCall(repo, 'show', { ref: '--output=stolen.txt' })).rejects.toThrow(
      /revision/u,
    );
    await expect(gitCall(repo, 'show', { ref: 'HEAD; rm' })).rejects.toThrow(/revision/u);
    await expect(gitCall(repo, 'show', { path: '../x' })).rejects.toThrow();
    expect(existsSync(path.join(repo, 'stolen.txt'))).toBe(false);
  });

  it('lists branches and the current one', async () => {
    const repo = makeRepository();
    git(repo, 'branch', 'side');

    const result = await gitCall(repo, 'branch');

    expect(result.current).toBe('main');
    expect(result.stdout).toContain('side');
  });

  it('lists remotes with credentials removed', async () => {
    const repo = makeRepository();
    git(repo, 'remote', 'add', 'origin', 'https://someone:secret-token@example.com/team/repo.git');
    git(repo, 'remote', 'add', 'ci', 'https://ghp_abcdef123@example.com/team/other.git');

    const result = await gitCall(repo, 'remote');

    expect(JSON.stringify(result)).not.toMatch(/secret-token|ghp_abcdef123|someone/u);
    expect(result.remotes).toEqual([
      {
        name: 'ci',
        fetchUrl: 'https://***@example.com/team/other.git',
        pushUrl: 'https://***@example.com/team/other.git',
      },
      {
        name: 'origin',
        fetchUrl: 'https://***@example.com/team/repo.git',
        pushUrl: 'https://***@example.com/team/repo.git',
      },
    ]);
  });
});
