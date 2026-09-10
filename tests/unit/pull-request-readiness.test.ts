import { describe, expect, it } from 'vitest';

import {
  assessPullRequestReadiness,
  describeBlocker,
  describeReadiness,
} from '../../src/core/pull-request-readiness';

import type { PullRequestFacts } from '../../src/core/pull-request-readiness.types';

function facts(overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
  return {
    currentBranch: 'feat/parser',
    baseBranch: 'main',
    remotes: ['origin'],
    aheadBy: 3,
    behindBy: 0,
    dirtyPaths: [],
    hasUpstream: true,
    ...overrides,
  };
}

describe('assessPullRequestReadiness', () => {
  it('says ready when everything git can check is in order', () => {
    expect(assessPullRequestReadiness(facts())).toEqual({
      ready: true,
      blockers: [],
      warnings: [],
    });
  });

  it('reports a repository with no remote, which has nowhere to open one', () => {
    const readiness = assessPullRequestReadiness(facts({ remotes: [] }));

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain('no-remote');
  });

  it('reports sitting on the base branch', () => {
    expect(assessPullRequestReadiness(facts({ currentBranch: 'main' })).blockers).toContain(
      'on-base-branch',
    );
  });

  it('reports a branch with nothing the base does not already have', () => {
    expect(assessPullRequestReadiness(facts({ aheadBy: 0 })).blockers).toContain(
      'nothing-to-propose',
    );
  });

  it('reports uncommitted changes, which would not be in the pull request', () => {
    expect(assessPullRequestReadiness(facts({ dirtyPaths: ['src/a.ts'] })).blockers).toContain(
      'uncommitted-changes',
    );
  });

  it('reports a branch that has never been pushed', () => {
    expect(assessPullRequestReadiness(facts({ hasUpstream: false })).blockers).toContain(
      'not-pushed',
    );
  });

  it('orders blockers so the first one unblocks the rest', () => {
    const readiness = assessPullRequestReadiness(
      facts({
        remotes: [],
        currentBranch: 'main',
        aheadBy: 0,
        dirtyPaths: ['src/a.ts'],
        hasUpstream: false,
      }),
    );

    expect(readiness.blockers).toEqual([
      'no-remote',
      'on-base-branch',
      'nothing-to-propose',
      'uncommitted-changes',
      'not-pushed',
    ]);
  });

  it('treats being behind as a warning, because a behind branch still merges', () => {
    const readiness = assessPullRequestReadiness(facts({ behindBy: 12 }));

    expect(readiness.ready).toBe(true);
    expect(readiness.warnings[0]).toContain('12 commit(s) behind main');
  });

  it('says nothing about being behind when it is not', () => {
    expect(assessPullRequestReadiness(facts({ behindBy: 0 })).warnings).toEqual([]);
  });
});

describe('describeBlocker', () => {
  it('names the base branch a caller must move off', () => {
    expect(describeBlocker('on-base-branch', facts({ baseBranch: 'develop' }))).toContain(
      'develop',
    );
  });

  it('counts the files that would be left out', () => {
    expect(describeBlocker('uncommitted-changes', facts({ dirtyPaths: ['a', 'b'] }))).toContain(
      '2 file(s)',
    );
  });

  it('has a sentence for every blocker it can produce', () => {
    const all = assessPullRequestReadiness(
      facts({
        remotes: [],
        currentBranch: 'main',
        aheadBy: 0,
        dirtyPaths: ['a'],
        hasUpstream: false,
      }),
    );

    for (const blocker of all.blockers) {
      expect(describeBlocker(blocker, facts()).length).toBeGreaterThan(10);
    }
  });
});

describe('describeReadiness', () => {
  it('says a healthy branch is ready, rather than saying nothing at all', () => {
    const summary = describeReadiness(assessPullRequestReadiness(facts()), facts());

    expect(summary).toContain('feat/parser');
    expect(summary).toContain('ready');
  });

  it('carries warnings even when the branch is ready', () => {
    const withBehind = facts({ behindBy: 4 });

    expect(describeReadiness(assessPullRequestReadiness(withBehind), withBehind)).toContain(
      '4 commit(s) behind',
    );
  });

  it('lists every blocker when the branch is not ready', () => {
    const broken = facts({ remotes: [], aheadBy: 0 });
    const summary = describeReadiness(assessPullRequestReadiness(broken), broken);

    expect(summary).toContain('no remote');
    expect(summary).toContain('no commits');
  });
});
