import { existsSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanUpRepositories,
  cloneOf,
  git,
  gitCall,
  installHook,
  makeRepository,
  makeRepositoryWithRemote,
  writeIn,
} from './sdk-git-tools.helpers';

afterEach(cleanUpRepositories);

/** Commits `name` in `repository` with plain git, for set-up. */
function commitFile(repository: string, name: string, content: string): void {
  writeIn(repository, name, content);
  git(repository, 'add', name);
  git(repository, 'commit', '--quiet', '-m', `edit ${name}`);
}

describe('push', () => {
  it('pushes the current branch to origin and sets its upstream', async () => {
    const { work, bare } = makeRepositoryWithRemote();
    await gitCall(work, 'switch', { branch: 'feature/one', create: true });
    commitFile(work, 'one.txt', '1');

    const result = await gitCall(work, 'push');

    expect(result).toMatchObject({
      exitCode: 0,
      pushed: true,
      rejected: false,
      branch: 'feature/one',
    });
    expect(git(bare, 'rev-parse', 'refs/heads/feature/one')).toBe(git(work, 'rev-parse', 'HEAD'));
    expect(git(work, 'rev-parse', '--abbrev-ref', 'feature/one@{upstream}')).toBe(
      'origin/feature/one',
    );
  });

  it('pushes HEAD to a named branch', async () => {
    const { work, bare } = makeRepositoryWithRemote();
    commitFile(work, 'one.txt', '1');

    const result = await gitCall(work, 'push', { branch: 'release/next' });

    expect(result.pushed).toBe(true);
    expect(git(bare, 'rev-parse', 'refs/heads/release/next')).toBe(git(work, 'rev-parse', 'HEAD'));
  });

  it('refuses a rejected non-fast-forward push and force cannot be requested', async () => {
    const { work, bare } = makeRepositoryWithRemote();
    const colleague = cloneOf(bare);
    commitFile(colleague, 'theirs.txt', 't');
    git(colleague, 'push', '--quiet', 'origin', 'main');
    const remoteHead = git(bare, 'rev-parse', 'refs/heads/main');
    commitFile(work, 'mine.txt', 'm');

    const result = await gitCall(work, 'push', { force: true, flags: ['--force'], mirror: true });

    expect(result).toMatchObject({ pushed: false, rejected: true });
    expect(result.exitCode).not.toBe(0);
    expect(git(bare, 'rev-parse', 'refs/heads/main')).toBe(remoteHead);
  });

  it('never pushes tags', async () => {
    const { work, bare } = makeRepositoryWithRemote();
    git(work, 'tag', '-a', 'v1', '-m', 'v1');
    git(work, 'config', 'push.followTags', 'true');
    commitFile(work, 'one.txt', '1');

    await gitCall(work, 'push');

    expect(git(bare, 'tag', '--list')).toBe('');
  });

  it.each([
    '--delete',
    '--upload-pack=x',
    '-f',
    ':main',
    'main:evil',
    '+main',
    'a..b',
    '',
    'x.lock',
  ])('refuses the branch %j', async (branch) => {
    const { work, bare } = makeRepositoryWithRemote();
    const before = git(bare, 'for-each-ref');

    await expect(gitCall(work, 'push', { branch })).rejects.toThrow();

    expect(git(bare, 'for-each-ref')).toBe(before);
  });

  it('refuses a detached HEAD with no branch named', async () => {
    const { work } = makeRepositoryWithRemote();
    git(work, 'checkout', '--quiet', '--detach');

    await expect(gitCall(work, 'push')).rejects.toThrow(/detached/u);
  });

  it('runs the pre-push hook, and a failing one stops the push', async () => {
    const { work, bare } = makeRepositoryWithRemote();
    installHook(work, 'pre-push', 'echo "tests red" >&2\nexit 1');
    commitFile(work, 'one.txt', '1');
    const before = git(bare, 'rev-parse', 'refs/heads/main');

    const result = await gitCall(work, 'push');

    expect(result).toMatchObject({ pushed: false });
    expect(result.stderr).toContain('tests red');
    expect(git(bare, 'rev-parse', 'refs/heads/main')).toBe(before);
  });
});

describe('fetch and pull', () => {
  it('fetches origin', async () => {
    const { work, bare } = makeRepositoryWithRemote();
    const colleague = cloneOf(bare);
    commitFile(colleague, 'theirs.txt', 't');
    git(colleague, 'push', '--quiet', 'origin', 'main');

    const result = await gitCall(work, 'fetch');

    expect(result.exitCode).toBe(0);
    expect(git(work, 'rev-parse', 'origin/main')).toBe(git(bare, 'rev-parse', 'refs/heads/main'));
  });

  it('rebases local commits onto the remote', async () => {
    const { work, bare } = makeRepositoryWithRemote();
    const colleague = cloneOf(bare);
    commitFile(colleague, 'theirs.txt', 't');
    git(colleague, 'push', '--quiet', 'origin', 'main');
    commitFile(work, 'mine.txt', 'm');

    const result = await gitCall(work, 'pull');

    expect(result).toMatchObject({ exitCode: 0, conflicts: [] });
    expect(git(work, 'log', '--format=%s')).toBe('edit mine.txt\nedit theirs.txt\nseed');
    expect(git(work, 'rev-list', '--merges', '--count', 'HEAD')).toBe('0');
  });

  it('reports a conflict as a result, aborts the rebase and leaves a clean tree', async () => {
    const { work, bare } = makeRepositoryWithRemote();
    const colleague = cloneOf(bare);
    commitFile(colleague, 'seed.txt', 'theirs\n');
    git(colleague, 'push', '--quiet', 'origin', 'main');
    commitFile(work, 'seed.txt', 'mine\n');
    const mine = git(work, 'rev-parse', 'HEAD');

    const result = await gitCall(work, 'pull');

    expect(result).toMatchObject({ conflicts: ['seed.txt'], rebaseAborted: true });
    expect(result.exitCode).not.toBe(0);
    expect(git(work, 'rev-parse', 'HEAD')).toBe(mine);
    expect(git(work, 'status', '--porcelain')).toBe('');
    expect(existsSync(path.join(work, '.git', 'rebase-merge'))).toBe(false);
  });

  it('refuses to autostash: a dirty tree stops the pull and stays dirty', async () => {
    const { work, bare } = makeRepositoryWithRemote();
    const colleague = cloneOf(bare);
    commitFile(colleague, 'theirs.txt', 't');
    git(colleague, 'push', '--quiet', 'origin', 'main');
    git(work, 'config', 'rebase.autoStash', 'true');
    writeIn(work, 'seed.txt', 'dirty\n');

    const result = await gitCall(work, 'pull');

    expect(result.exitCode).not.toBe(0);
    expect(git(work, 'status', '--porcelain')).toContain('seed.txt');
    expect(git(work, 'stash', 'list')).toBe('');
  });

  it('fails plainly with no remote', async () => {
    const repo = makeRepository();

    const result = await gitCall(repo, 'fetch');

    expect(result.exitCode).not.toBe(0);
  });
});

describe('long-running hooks', () => {
  it('kills a hook that outlives timeoutSeconds and says so', async () => {
    const repo = makeRepository();
    installHook(repo, 'pre-commit', 'echo started >&2\nsleep 60');
    writeIn(repo, 'a.txt', 'a');
    await gitCall(repo, 'add', { paths: ['a.txt'] });
    const started = Date.now();

    const result = await gitCall(repo, 'commit', { message: 'slow', timeoutSeconds: 1 });

    expect(result).toMatchObject({ committed: false, timedOut: true });
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(git(repo, 'log', '--format=%s')).toBe('seed');
  }, 30_000);

  it('kills the process tree when the run is aborted', async () => {
    const repo = makeRepository();
    installHook(repo, 'pre-commit', 'sleep 60');
    writeIn(repo, 'a.txt', 'a');
    await gitCall(repo, 'add', { paths: ['a.txt'] });
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 800);
    const started = Date.now();

    const result = await gitCall(repo, 'commit', { message: 'slow' }, controller.signal);

    expect(result).toMatchObject({ committed: false, aborted: true });
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 30_000);

  it('keeps both ends of huge hook output within the result ceiling', async () => {
    const repo = makeRepository();
    installHook(
      repo,
      'pre-commit',
      'echo FIRST-LINE >&2\ni=0\nwhile [ $i -lt 3000 ]; do echo "noise noise noise noise noise noise noise noise noise noise $i" >&2; i=$((i+1)); done\necho LAST-LINE >&2\nexit 1',
    );
    writeIn(repo, 'a.txt', 'a');
    await gitCall(repo, 'add', { paths: ['a.txt'] });

    const result = await gitCall(repo, 'commit', { message: 'noisy' });

    expect(String(result.stderr)).toContain('FIRST-LINE');
    expect(String(result.stderr)).toContain('LAST-LINE');
    expect(String(result.stderr)).toContain('characters omitted');
    expect(JSON.stringify(result).length).toBeLessThan(60_000);
  }, 60_000);
});
