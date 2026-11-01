import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanUpRepositories,
  git,
  gitCall,
  makeRepository,
  makeRepositoryWithRemote,
  writeIn,
} from './sdk-git-tools.helpers';

afterEach(cleanUpRepositories);

function commitFile(repository: string, name: string, content: string): void {
  writeIn(repository, name, content);
  git(repository, 'add', name);
  git(repository, 'commit', '--quiet', '-m', `edit ${name}`);
}

/** `main` and `feature` each changed `shared.txt` differently, with `feature` checked out. */
function divergedRepository(): string {
  const repository = makeRepository();
  commitFile(repository, 'shared.txt', 'base\n');
  git(repository, 'switch', '--quiet', '-c', 'feature');
  commitFile(repository, 'shared.txt', 'feature\n');
  git(repository, 'switch', '--quiet', 'main');
  commitFile(repository, 'shared.txt', 'main\n');
  git(repository, 'switch', '--quiet', 'feature');
  return repository;
}

describe('merge', () => {
  it('merges a local branch', async () => {
    const repository = makeRepository();
    git(repository, 'switch', '--quiet', '-c', 'feature');
    commitFile(repository, 'one.txt', '1');
    git(repository, 'switch', '--quiet', 'main');

    const result = await gitCall(repository, 'merge', { branch: 'feature' });

    expect(result).toMatchObject({ exitCode: 0, conflicts: [], branch: 'feature' });
    expect(git(repository, 'log', '--format=%s', '-1')).toBe('edit one.txt');
  });

  it('reports a conflict, aborts the merge and leaves a clean tree', async () => {
    const repository = divergedRepository();

    const result = await gitCall(repository, 'merge', { branch: 'main' });

    expect(result).toMatchObject({ ok: false, conflicts: ['shared.txt'], mergeAborted: true });
    expect(git(repository, 'status', '--porcelain')).toBe('');
  });

  it.each([['-x'], ['a..b'], ['x@{1}'], [''], ['--upload-pack=evil']])(
    'refuses the branch %j',
    async (branch) => {
      await expect(gitCall(makeRepository(), 'merge', { branch })).rejects.toThrow();
    },
  );

  it('needs a branch', async () => {
    await expect(gitCall(makeRepository(), 'merge', {})).rejects.toThrow('requires a "branch"');
  });
});

describe('rebase', () => {
  it('rebases the current branch onto a local branch', async () => {
    const repository = makeRepository();
    git(repository, 'switch', '--quiet', '-c', 'feature');
    commitFile(repository, 'feature.txt', 'f');
    git(repository, 'switch', '--quiet', 'main');
    commitFile(repository, 'main.txt', 'm');
    git(repository, 'switch', '--quiet', 'feature');

    const result = await gitCall(repository, 'rebase', { branch: 'main' });

    expect(result).toMatchObject({ exitCode: 0, conflicts: [] });
    expect(git(repository, 'log', '--format=%s', '-2').split('\n')).toEqual([
      'edit feature.txt',
      'edit main.txt',
    ]);
  });

  it('reports a conflict, aborts the rebase and leaves a clean tree', async () => {
    const repository = divergedRepository();

    const result = await gitCall(repository, 'rebase', { branch: 'main' });

    expect(result).toMatchObject({ ok: false, conflicts: ['shared.txt'], rebaseAborted: true });
    expect(git(repository, 'status', '--porcelain')).toBe('');
    expect(git(repository, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature');
  });

  it('refuses a flag as the branch', async () => {
    await expect(gitCall(makeRepository(), 'rebase', { branch: '--exec=evil' })).rejects.toThrow();
  });
});

describe('stash', () => {
  it('shelves tracked changes, lists them, and brings them back', async () => {
    const repository = makeRepository();
    writeIn(repository, 'seed.txt', 'changed\n');

    expect(
      await gitCall(repository, 'stash', { action: 'push', message: 'wip seed' }),
    ).toMatchObject({ exitCode: 0 });
    expect(git(repository, 'status', '--porcelain')).toBe('');
    expect(await gitCall(repository, 'stash', { action: 'list' })).toMatchObject({
      stdout: expect.stringContaining('wip seed') as string,
    });

    const popped = await gitCall(repository, 'stash', { action: 'pop' });
    expect(popped).toMatchObject({ exitCode: 0, conflicts: [] });
    expect(git(repository, 'status', '--porcelain')).toBe('M seed.txt');
  });

  it('leaves untracked files where they are', async () => {
    const repository = makeRepository();
    writeIn(repository, 'new.txt', 'n\n');
    await gitCall(repository, 'stash', { action: 'push' });
    expect(git(repository, 'status', '--porcelain')).toBe('?? new.txt');
  });

  it('refuses to pop onto a dirty tree', async () => {
    const repository = makeRepository();
    writeIn(repository, 'seed.txt', 'one\n');
    await gitCall(repository, 'stash', { action: 'push' });
    writeIn(repository, 'seed.txt', 'two\n');
    await expect(gitCall(repository, 'stash', { action: 'pop' })).rejects.toThrow(
      'uncommitted changes',
    );
  });

  it('reverts a conflicting pop and keeps the stash', async () => {
    const repository = makeRepository();
    writeIn(repository, 'seed.txt', 'stashed\n');
    await gitCall(repository, 'stash', { action: 'push' });
    commitFile(repository, 'seed.txt', 'committed\n');

    const result = await gitCall(repository, 'stash', { action: 'pop' });

    expect(result).toMatchObject({
      ok: false,
      conflicts: ['seed.txt'],
      popReverted: true,
      stashKept: true,
    });
    expect(git(repository, 'status', '--porcelain')).toBe('');
    expect(git(repository, 'stash', 'list')).not.toBe('');
  });

  it('needs a known action and a one-line message', async () => {
    const repository = makeRepository();
    await expect(gitCall(repository, 'stash', {})).rejects.toThrow('push, pop or list');
    await expect(gitCall(repository, 'stash', { action: 'drop' })).rejects.toThrow(
      'push, pop or list',
    );
    await expect(gitCall(repository, 'stash', { action: 'push', message: 'a\nb' })).rejects.toThrow(
      'one line',
    );
  });
});

describe('tag', () => {
  it('creates one annotated local tag and lists it', async () => {
    const repository = makeRepository();

    const made = await gitCall(repository, 'tag', { name: 'v1.0.0', message: 'first release' });

    expect(made).toMatchObject({ exitCode: 0, created: true, tag: 'v1.0.0' });
    expect(git(repository, 'cat-file', '-t', 'v1.0.0')).toBe('tag');
    expect(await gitCall(repository, 'tag', {})).toMatchObject({
      stdout: expect.stringContaining('v1.0.0') as string,
    });
  });

  it('will not replace an existing tag', async () => {
    const repository = makeRepository();
    await gitCall(repository, 'tag', { name: 'v1' });
    const again = await gitCall(repository, 'tag', { name: 'v1' });
    expect(again).toMatchObject({ ok: false, created: false });
  });

  it.each([['-f'], ['v1..2'], ['bad name'], ['x.lock']])('refuses the name %j', async (name) => {
    await expect(gitCall(makeRepository(), 'tag', { name })).rejects.toThrow();
  });

  it('never publishes a tag when the branch is pushed', async () => {
    const { work, bare } = makeRepositoryWithRemote();
    await gitCall(work, 'tag', { name: 'v2' });
    await gitCall(work, 'push');
    expect(git(bare, 'tag', '--list')).toBe('');
  });
});
