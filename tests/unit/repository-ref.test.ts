import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { repositoryRefOf, repositoryRemoteIdentifier } from '../../src/core/repository-ref';
import { workspaceGitFacts } from '../../src/infrastructure/workspace-git-facts';

describe('repositoryRemoteIdentifier', () => {
  it.each([
    ['https://github.com/acme/app.git', 'https://github.com/acme/app'],
    ['git@github.com:acme/app.git', 'https://github.com/acme/app'],
    ['ssh://git@Example.COM:2222/acme/app.git/', 'https://example.com/acme/app'],
    ['https://example.com:8443/acme/app', 'https://example.com:8443/acme/app'],
  ])('reduces %s to one identifier', (raw, expected) => {
    expect(repositoryRemoteIdentifier(raw)).toBe(expected);
  });

  it('strips credentials, query and fragment so a token never leaves the machine', () => {
    const marker = 'tok-not-a-real-credential-4412';
    const result = repositoryRemoteIdentifier(
      `https://deploy:${marker}@github.com/acme/app.git?access=${marker}#${marker}`,
    );
    expect(result).toBe('https://github.com/acme/app');
    expect(result).not.toContain(marker);
    expect(repositoryRemoteIdentifier(`https://${marker}@github.com/acme/app`)).toBe(
      'https://github.com/acme/app',
    );
  });

  it.each([
    'file:///home/me/repo',
    '/home/me/repo',
    'C:/work/repo',
    'javascript:alert(1)',
    'https://github.com/../etc',
    'https://github.com/a b/c',
    '',
    undefined,
  ])('refuses %s', (raw) => {
    expect(repositoryRemoteIdentifier(raw)).toBeUndefined();
  });
});

describe('repositoryRefOf', () => {
  it('sends name, remote and branch for a workspace with a git remote', () => {
    expect(
      repositoryRefOf({
        folderName: 'app',
        remoteUrl: 'https://u:p@github.com/acme/app.git',
        branch: 'feature/x',
      }),
    ).toEqual({ name: 'app', remoteUrl: 'https://github.com/acme/app', branch: 'feature/x' });
  });

  it('sends nothing for a workspace with no remote', () => {
    expect(repositoryRefOf({ folderName: 'app', remoteUrl: undefined, branch: 'main' })).toBe(
      undefined,
    );
  });

  it('leaves out a branch that is not a plain ref name', () => {
    const ref = repositoryRefOf({
      folderName: 'app',
      remoteUrl: 'https://github.com/acme/app',
      branch: 'a b~c',
    });
    expect(ref).toEqual({ name: 'app', remoteUrl: 'https://github.com/acme/app' });
  });
});

describe('workspaceGitFacts', () => {
  const made: string[] = [];
  afterEach(() => {
    for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function checkout(config: string, head: string): string {
    const root = mkdtempSync(path.join(tmpdir(), 'claw-gitfacts-'));
    made.push(root);
    mkdirSync(path.join(root, '.git'));
    writeFileSync(path.join(root, '.git', 'config'), config);
    writeFileSync(path.join(root, '.git', 'HEAD'), head);
    return root;
  }

  it('reads the origin remote and the branch without running git', () => {
    const root = checkout(
      '[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://github.com/other/app.git\n[remote "origin"]\n\turl = git@github.com:acme/app.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
      'ref: refs/heads/feature/x\n',
    );
    expect(workspaceGitFacts(root)).toMatchObject({
      folderName: path.basename(root),
      remoteUrl: 'git@github.com:acme/app.git',
      branch: 'feature/x',
    });
  });

  it('has no remote and no branch for a fresh repository or a detached head', () => {
    const root = checkout('[core]\n\tbare = false\n', '0123456789abcdef0123456789abcdef01234567\n');
    expect(workspaceGitFacts(root)).toMatchObject({ remoteUrl: undefined, branch: undefined });
  });

  it('returns undefined outside a repository', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'claw-gitfacts-'));
    made.push(root);
    expect(workspaceGitFacts(root)).toBeUndefined();
    expect(workspaceGitFacts(path.join(root, 'missing'))).toBeUndefined();
  });
});
