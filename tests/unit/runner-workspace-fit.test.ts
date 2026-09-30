import { describe, expect, it } from 'vitest';

import { runnerWorkspaceFit } from '../../src/core/runner-workspace-fit';

const repos = [{ name: 'Claw', repoPath: 'D:\\work\\claw-app' }];

describe('runnerWorkspaceFit', () => {
  it('matches by repository name, ignoring case', () => {
    expect(runnerWorkspaceFit({ runnerRepos: repos, workspaceNames: ['claw'] })).toBe('match');
  });

  it('matches by the last segment of the checkout path, either separator', () => {
    expect(runnerWorkspaceFit({ runnerRepos: repos, workspaceNames: ['claw-app'] })).toBe('match');
    const posix = [{ name: 'x', repoPath: '/srv/site/' }];
    expect(runnerWorkspaceFit({ runnerRepos: posix, workspaceNames: ['site'] })).toBe('match');
  });

  it('reports a mismatch when no open folder is a runner repository', () => {
    expect(runnerWorkspaceFit({ runnerRepos: repos, workspaceNames: ['other'] })).toBe('mismatch');
  });

  it('is unknown, never a warning, without runner data or an open folder', () => {
    expect(runnerWorkspaceFit({ runnerRepos: [], workspaceNames: ['a'] })).toBe('unknown');
    expect(runnerWorkspaceFit({ runnerRepos: repos, workspaceNames: [] })).toBe('unknown');
  });
});
