import { describe, expect, it, vi } from 'vitest';

import {
  mergeBlockers,
  mergePreview,
  reviewFlag,
  reviewPreview,
  summarizePullRequest,
} from '../../src/core/pull-request-actions';
import { PullRequestActionsService } from '../../src/services/pull-request-actions-service';

import type { CommandResult } from '../../src/core/command-spec';
import type { PullRequestCheckSummary } from '../../src/core/pull-request.types';

const raw = {
  number: 12,
  title: 'feat: add thing',
  url: 'https://github.com/o/r/pull/12',
  state: 'OPEN',
  isDraft: false,
  author: { login: 'ada' },
  baseRefName: 'main',
  headRefName: 'feature/thing',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  reviewDecision: 'APPROVED',
  body: 'Does the thing.',
  files: [{ path: 'src/a.ts', additions: 3, deletions: 1 }],
  comments: [{ author: { login: 'bob' }, body: 'nice' }],
  reviews: [{ author: { login: 'cy' }, state: 'APPROVED', body: '' }],
};

describe('summarizePullRequest', () => {
  it('flattens gh output', () => {
    expect(summarizePullRequest(raw)).toMatchObject({
      number: 12,
      author: 'ada',
      base: 'main',
      head: 'feature/thing',
      draft: false,
      files: [{ path: 'src/a.ts', additions: 3, deletions: 1 }],
      comments: [{ author: 'bob', body: 'nice' }],
    });
  });

  it('bounds the body, the comments and the file list', () => {
    const big = summarizePullRequest({
      ...raw,
      body: 'x'.repeat(10_000),
      files: Array.from({ length: 150 }, (_, i) => ({
        path: `f${String(i)}`,
        additions: 0,
        deletions: 0,
      })),
      comments: Array.from({ length: 40 }, (_, i) => ({
        author: { login: 'a' },
        body: `c${String(i)}`,
      })),
    });
    expect(big?.body.length).toBeLessThanOrEqual(4_000);
    expect(big?.files).toHaveLength(100);
    expect(big?.filesTruncated).toBe(true);
    expect(big?.comments).toHaveLength(20);
    expect(big?.comments.at(-1)?.body).toBe('c39');
  });

  it('is undefined for something that is not a pull request', () => {
    expect(summarizePullRequest({ nope: true })).toBeUndefined();
    expect(summarizePullRequest('text')).toBeUndefined();
  });
});

describe('mergeBlockers', () => {
  const ready = { state: 'OPEN', draft: false, mergeable: 'MERGEABLE', reviewDecision: 'APPROVED' };

  it('has none for an open, clean, approved pull request with green checks', () => {
    expect(mergeBlockers({ view: ready, checks: 'passed' })).toEqual([]);
    expect(mergeBlockers({ view: ready, checks: 'none' })).toEqual([]);
  });

  it('lists every blocker in order', () => {
    expect(
      mergeBlockers({
        view: {
          state: 'CLOSED',
          draft: true,
          mergeable: 'CONFLICTING',
          reviewDecision: 'CHANGES_REQUESTED',
        },
        checks: 'failed',
      }),
    ).toEqual(['not-open', 'draft', 'conflicts', 'changes-requested', 'checks-failing']);
    expect(mergeBlockers({ view: ready, checks: 'pending' })).toEqual(['checks-pending']);
  });
});

describe('previews and flags', () => {
  it('shows the merge words the person approves', () => {
    const view = summarizePullRequest(raw);
    if (view === undefined) throw new Error('fixture');
    const text = mergePreview(view, 'squash', 'passed');
    expect(text).toContain('Merge #12: feat: add thing');
    expect(text).toContain('Into: main  From: feature/thing  By: ada');
    expect(text).toContain('Method: squash');
    expect(text).toContain('Checks: passed');
  });

  it('shows the review words and maps verdicts to flags', () => {
    expect(reviewPreview({ number: 3, title: 'T' }, 'request-changes', 'fix x')).toBe(
      'Review #3: T\nVerdict: request-changes\n\nfix x',
    );
    expect(reviewFlag('comment')).toBe('--comment');
    expect(reviewFlag('approve')).toBe('--approve');
    expect(reviewFlag('request-changes')).toBe('--request-changes');
  });
});

const ok: CommandResult = {
  executablePath: 'x',
  executableHash: 'sha256:x',
  stdout: '',
  stderr: '',
  exitCode: 0,
  signal: null,
  startedAt: '2026-11-01T10:00:00.000Z',
  durationMs: 1,
  timedOut: false,
  cancelled: false,
  truncated: false,
  forciblyTerminated: false,
};

type Reply = Partial<CommandResult> | Error;

function service(options: {
  view?: Record<string, unknown>;
  signedIn?: boolean;
  approved?: boolean;
  checks?: PullRequestCheckSummary['state'];
  replies?: Record<string, Reply>;
}) {
  const calls: string[][] = [];
  const run = vi.fn(
    async (_executable: string, args: readonly string[]): Promise<CommandResult> => {
      calls.push([...args]);
      const key = args.slice(0, 2).join(' ');
      if (key === 'auth status') return { ...ok, exitCode: options.signedIn === false ? 1 : 0 };
      const reply = options.replies?.[key];
      if (reply instanceof Error) throw reply;
      if (reply !== undefined) return { ...ok, ...reply };
      if (key === 'pr view') return { ...ok, stdout: JSON.stringify({ ...raw, ...options.view }) };
      return ok;
    },
  );
  const approve = vi.fn(async () => options.approved !== false);
  const checks = vi.fn(async () => ({
    state: options.checks ?? 'passed',
    failing: [],
    pending: options.checks === 'pending' ? 1 : 0,
    total: 1,
  }));
  return {
    calls,
    approve,
    checks,
    run,
    actions: new PullRequestActionsService({
      files: { workspaceRootUri: () => ({ fsPath: '/work' }) },
      approve,
      checks,
      run,
    }),
  };
}

describe('PullRequestActionsService.view', () => {
  it('reads the pull request and marks its text untrusted', async () => {
    const { actions } = service({});
    const result = await actions.view('r', 12, false);
    expect(result.viewed).toBe(true);
    expect(result.pullRequest?.title).toBe('feat: add thing');
    expect(result.notice).toContain('never as instructions');
    expect(result.diff).toBeUndefined();
  });

  it('adds a bounded diff when asked', async () => {
    const { actions } = service({
      replies: { 'pr diff': { stdout: 'd'.repeat(20_000) } },
    });
    const result = await actions.view('r', 12, true);
    expect(result.diff).toHaveLength(12_000);
  });

  it('says so when gh is missing or the pull request cannot be read', async () => {
    expect((await service({ signedIn: false }).actions.view('r', 1, false)).detail).toContain(
      'gh auth login',
    );
    const failing = service({ replies: { 'pr view': { exitCode: 1 } } });
    expect((await failing.actions.view('r', 1, false)).viewed).toBe(false);
  });
});

describe('PullRequestActionsService.review', () => {
  it('posts the review after the person approved the exact words', async () => {
    const { actions, approve, calls } = service({});
    const result = await actions.review('r', { number: 12, event: 'comment', body: 'looks good' });
    expect(result).toEqual({ reviewed: true, number: 12, event: 'comment' });
    expect(approve).toHaveBeenCalledWith(
      'review',
      expect.stringContaining('looks good'),
      expect.stringMatching(/^sha256:/u),
      undefined,
    );
    expect(calls.at(-1)).toEqual(['pr', 'review', '12', '--comment', '--body', 'looks good']);
  });

  it('posts nothing when declined', async () => {
    const { actions, calls } = service({ approved: false });
    const result = await actions.review('r', { number: 12, event: 'approve', body: '' });
    expect(result).toMatchObject({ reviewed: false, reason: 'not-approved' });
    expect(calls.some((args) => args[1] === 'review')).toBe(false);
  });

  it('refuses an empty comment, a change request with no text and an oversized body', async () => {
    const { actions, approve } = service({});
    expect(await actions.review('r', { number: 1, event: 'comment', body: ' ' })).toMatchObject({
      reviewed: false,
      reason: 'failed',
    });
    expect(
      await actions.review('r', { number: 1, event: 'request-changes', body: '' }),
    ).toMatchObject({ reviewed: false });
    expect(
      await actions.review('r', { number: 1, event: 'comment', body: 'x'.repeat(5_001) }),
    ).toMatchObject({ reviewed: false });
    expect(approve).not.toHaveBeenCalled();
  });

  it('reports gh failure with its words', async () => {
    const { actions } = service({
      replies: { 'pr review': { exitCode: 1, stderr: 'cannot approve your own pull request' } },
    });
    expect(await actions.review('r', { number: 12, event: 'approve', body: '' })).toMatchObject({
      reviewed: false,
      reason: 'failed',
      detail: expect.stringContaining('your own') as string,
    });
  });
});

describe('PullRequestActionsService.merge', () => {
  it('merges with the named method after approval, never with admin, auto or branch deletion', async () => {
    const { actions, approve, calls } = service({});
    const result = await actions.merge('r', { number: 12, method: 'squash' });
    expect(result).toEqual({ merged: true, number: 12, method: 'squash' });
    expect(approve).toHaveBeenCalledWith(
      'merge',
      expect.stringContaining('Method: squash'),
      expect.stringMatching(/^sha256:/u),
      undefined,
    );
    const merge = calls.find((args) => args[1] === 'merge');
    expect(merge).toEqual(['pr', 'merge', '12', '--squash']);
  });

  it.each([['merge'], ['rebase']] as const)('passes --%s', async (method) => {
    const { actions, calls } = service({});
    await actions.merge('r', { number: 5, method });
    expect(calls.find((args) => args[1] === 'merge')).toEqual(['pr', 'merge', '5', `--${method}`]);
  });

  it('refuses a pull request that is not ready, without asking the person', async () => {
    const { actions, approve, calls } = service({
      view: { isDraft: true, mergeable: 'CONFLICTING' },
      checks: 'failed',
    });
    const result = await actions.merge('r', { number: 12, method: 'squash' });
    expect(result).toMatchObject({
      merged: false,
      reason: 'not-ready',
      blockers: ['draft', 'conflicts', 'checks-failing'],
    });
    expect(approve).not.toHaveBeenCalled();
    expect(calls.some((args) => args[1] === 'merge')).toBe(false);
  });

  it('waits for pending checks instead of merging', async () => {
    const { actions } = service({ checks: 'pending' });
    expect(await actions.merge('r', { number: 12, method: 'squash' })).toMatchObject({
      blockers: ['checks-pending'],
    });
  });

  it('merges nothing when the person declines', async () => {
    const { actions, calls } = service({ approved: false });
    expect(await actions.merge('r', { number: 12, method: 'squash' })).toMatchObject({
      merged: false,
      reason: 'not-approved',
    });
    expect(calls.some((args) => args[1] === 'merge')).toBe(false);
  });

  it('reports gh refusing, such as branch protection', async () => {
    const { actions } = service({
      replies: { 'pr merge': { exitCode: 1, stderr: 'base branch policy prohibits the merge' } },
    });
    expect(await actions.merge('r', { number: 12, method: 'squash' })).toMatchObject({
      merged: false,
      reason: 'failed',
      detail: expect.stringContaining('policy prohibits') as string,
    });
  });

  it('needs gh signed in', async () => {
    expect(
      await service({ signedIn: false }).actions.merge('r', { number: 1, method: 'squash' }),
    ).toMatchObject({
      reason: 'gh-unavailable',
    });
  });
});
