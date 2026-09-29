import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { normalizeRepositoryUrl, originUrlFromGitConfig } from '../../src/core/repository-identity';
import {
  repositoryIdentityForRoot,
  workspaceRepositoryReader,
} from '../../src/infrastructure/workspace-repository-identity';

const created: string[] = [];
afterEach(async () => {
  for (const directory of created.splice(0)) await rm(directory, { recursive: true, force: true });
});

const CONFIG =
  '[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://x.io/a/b\n[remote "origin"]\n\turl = git@GitHub.com:Acme/App.git\n';

describe('normalizeRepositoryUrl', () => {
  it.each([
    ['git@github.com:acme/app.git', 'github.com/acme/app'],
    ['https://user@GitHub.com/acme/app.git', 'github.com/acme/app'],
    ['ssh://git@host.io:22/acme/app/', 'host.io/acme/app'],
    ['https://dev.azure.com/org/proj/_git/repo', 'dev.azure.com/org/proj/_git/repo'],
  ])('%s -> %s', (url, expected) => {
    expect(normalizeRepositoryUrl(url)).toBe(expected);
  });

  it.each(['file:///srv/repo.git', '/srv/repo.git', 'not a url', 'https://host.io/'])(
    'rejects %s',
    (url) => {
      expect(normalizeRepositoryUrl(url)).toBeUndefined();
    },
  );
});

describe('originUrlFromGitConfig', () => {
  it('reads only the origin remote', () => {
    expect(originUrlFromGitConfig(CONFIG)).toBe('git@GitHub.com:Acme/App.git');
    expect(originUrlFromGitConfig('[remote "upstream"]\n url = a:b/c\n')).toBeUndefined();
  });
});

describe('repositoryIdentityForRoot', () => {
  it('reads a repository and follows a worktree to its common config', async () => {
    const main = await mkdtemp(path.join(tmpdir(), 'clawai-repo-'));
    created.push(main);
    await mkdir(path.join(main, '.git', 'worktrees', 'wt'), { recursive: true });
    await writeFile(path.join(main, '.git', 'config'), CONFIG);
    expect(repositoryIdentityForRoot(main)).toBe('github.com/Acme/App');

    const worktreeDir = path.join(main, '.git', 'worktrees', 'wt');
    await writeFile(path.join(worktreeDir, 'commondir'), '../..\n');
    const worktree = await mkdtemp(path.join(tmpdir(), 'clawai-wt-'));
    created.push(worktree);
    await writeFile(path.join(worktree, '.git'), `gitdir: ${worktreeDir}\n`);
    expect(repositoryIdentityForRoot(worktree)).toBe('github.com/Acme/App');
  });

  it('is undefined with no git directory or a bad pointer', async () => {
    const plain = await mkdtemp(path.join(tmpdir(), 'clawai-plain-'));
    created.push(plain);
    expect(repositoryIdentityForRoot(plain)).toBeUndefined();
    await writeFile(path.join(plain, '.git'), 'garbage');
    expect(repositoryIdentityForRoot(plain)).toBeUndefined();
  });

  it('caches per root', async () => {
    const main = await mkdtemp(path.join(tmpdir(), 'clawai-repo-'));
    created.push(main);
    await mkdir(path.join(main, '.git'));
    await writeFile(path.join(main, '.git', 'config'), CONFIG);
    const read = workspaceRepositoryReader(() => main);
    expect(read()).toBe('github.com/Acme/App');
    await writeFile(path.join(main, '.git', 'config'), '');
    expect(read()).toBe('github.com/Acme/App');
  });
});
