import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const runCommandSpec = vi.hoisted(() => vi.fn());

vi.mock('../../src/infrastructure/bounded-command-runner', () => ({ runCommandSpec }));

import { PullRequestService } from '../../src/services/pull-request-service';

import type { GitReceipt } from '../../src/core/git-operation';
import type { PullRequestBlocker } from '../../src/core/pull-request-readiness.types';

const ok = {
  executablePath: 'x',
  executableHash: 'sha256:x',
  stdout: '',
  stderr: '',
  exitCode: 0,
  signal: null,
  startedAt: '2026-09-29T10:00:00.000Z',
  durationMs: 1,
  timedOut: false,
  cancelled: false,
  truncated: false,
};

type Responder = (executable: string, args: string[]) => Partial<typeof ok> | Error;

function respond(responder: Responder): void {
  runCommandSpec.mockImplementation(async (spec: { executable: string; arguments: string[] }) => {
    const answer = responder(spec.executable, spec.arguments);
    if (answer instanceof Error) throw answer;
    return { ...ok, ...answer };
  });
}

function harness(blockers: PullRequestBlocker[], approved = true) {
  const git = {
    execute: vi.fn(async (candidate: { operation: GitReceipt['operation'] }) => ({
      operation: candidate.operation,
      beforeHead: null,
      afterHead: null,
      beforeWorkingTreeHash: 'h',
      afterWorkingTreeHash: 'h',
      output: candidate.operation === 'remotes' ? 'origin\thttps://x (push)\n' : '',
      pullRequest: {
        ready: blockers.length === 0,
        blockers,
        warnings: [],
        facts: {
          currentBranch: 'feat/login',
          baseBranch: 'main',
          remotes: ['origin'],
          aheadBy: 1,
          behindBy: 0,
          dirtyPaths: [],
          hasUpstream: !blockers.includes('not-pushed'),
        },
      },
    })),
  };
  const approve = vi.fn(async () => approved);
  const opened = vi.fn();
  const service = new PullRequestService({
    files: { workspaceRootUri: () => ({ fsPath: path.resolve('/repo') }) },
    git,
    approve,
    opened,
  });
  return { service, git, approve, opened };
}

function ghCalls(): string[][] {
  return runCommandSpec.mock.calls
    .map(([spec]) => spec as { executable: string; arguments: string[] })
    .filter((spec) => spec.executable === 'gh')
    .map((spec) => spec.arguments);
}

describe('PullRequestService', () => {
  beforeEach(() => {
    runCommandSpec.mockReset();
  });

  it('drafts a conventional title from the only commit and the changed paths', async () => {
    respond((_, args) =>
      args[0] === 'log' ? { stdout: 'feat(auth): add login\n' } : { stdout: 'src/auth/login.ts\n' },
    );
    const { service } = harness([]);
    const result = await service.draft({ rootKey: 'workspace-0' });
    expect(result.draft.title).toBe('feat(auth): add login');
    expect(result.ready).toBe(true);
  });

  it('refuses before anything runs when a blocker other than not-pushed remains', async () => {
    respond(() => ({}));
    const { service, approve } = harness(['on-base-branch', 'not-pushed']);
    const result = await service.publish({ rootKey: 'workspace-0' });
    expect(result).toMatchObject({
      published: false,
      reason: 'not-ready',
      blockers: ['on-base-branch'],
    });
    expect(approve).not.toHaveBeenCalled();
    expect(ghCalls()).toEqual([]);
  });

  it('reports gh as unavailable when it is missing or signed out', async () => {
    respond((executable) => (executable === 'gh' ? new Error('Executable was not found: gh') : {}));
    const { service } = harness([]);
    expect(await service.publish({ rootKey: 'workspace-0' })).toMatchObject({
      published: false,
      reason: 'gh-unavailable',
    });
  });

  it('pushes, opens the pull request after approval, and hands it to the monitor', async () => {
    respond((executable, args) => {
      if (executable === 'gh' && args[1] === 'create') {
        return { stdout: 'https://github.com/o/r/pull/12\n' };
      }
      if (args[0] === 'diff') return { stdout: 'src/login.ts\n' };
      return { stdout: args[0] === 'log' ? 'add login\n' : '' };
    });
    const { service, git, approve, opened } = harness(['not-pushed']);
    const result = await service.publish({
      rootKey: 'workspace-0',
      title: 'Add login',
      draft: true,
    });
    expect(result).toMatchObject({
      published: true,
      url: 'https://github.com/o/r/pull/12',
      number: 12,
      pushed: true,
    });
    const [preview] = approve.mock.calls[0] as unknown as [string];
    expect(preview).toContain('Title: feat: Add login');
    expect(preview).toContain('will be pushed first');
    expect(git.execute).toHaveBeenCalledWith(
      { rootKey: 'workspace-0', operation: 'push', remote: 'origin', refspec: 'feat/login' },
      undefined,
    );
    const create = ghCalls().find((args) => args[1] === 'create');
    expect(create).toEqual([
      'pr',
      'create',
      '--base',
      'main',
      '--head',
      'feat/login',
      '--title',
      'feat: Add login',
      '--body',
      expect.stringContaining('`feat/login` into `main`'),
      '--draft',
    ]);
    expect(opened).toHaveBeenCalledWith({
      url: 'https://github.com/o/r/pull/12',
      number: 12,
      rootKey: 'workspace-0',
      branch: 'feat/login',
    });
  });

  it('does not push or open anything when the preview is declined', async () => {
    respond(() => ({}));
    const { service, git } = harness(['not-pushed'], false);
    expect(await service.publish({ rootKey: 'workspace-0' })).toMatchObject({
      reason: 'not-approved',
    });
    expect(git.execute.mock.calls.some(([call]) => call.operation === 'push')).toBe(false);
    expect(ghCalls().some((args) => args[1] === 'create')).toBe(false);
  });

  it('returns the existing pull request url instead of failing', async () => {
    respond((executable, args) =>
      executable === 'gh' && args[1] === 'create'
        ? {
            exitCode: 1,
            stderr:
              'a pull request for branch "feat/login" into branch "main" already exists:\nhttps://github.com/o/r/pull/3',
          }
        : {},
    );
    const { service, opened } = harness([]);
    expect(await service.publish({ rootKey: 'workspace-0' })).toMatchObject({
      published: false,
      reason: 'exists',
      url: 'https://github.com/o/r/pull/3',
    });
    expect(opened).not.toHaveBeenCalled();
  });

  it('reads checks even when gh exits non-zero, and fetches failed-job logs per run', async () => {
    respond((_, args) => {
      if (args[1] === 'checks') {
        return {
          exitCode: 1,
          stdout: JSON.stringify([
            { name: 'unit', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/55/job/1' },
            { name: 'lint', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/55/job/2' },
          ]),
        };
      }
      if (args[0] === 'run') return { stdout: 'FAIL src/a.test.ts\n' };
      return {};
    });
    const { service } = harness([]);
    const report = await service.failureLogs('workspace-0', 12);
    expect(report.summary.state).toBe('failed');
    expect(report.logs).toContain('# Actions run 55\nFAIL src/a.test.ts');
    expect(ghCalls().filter((args) => args[0] === 'run')).toEqual([
      ['run', 'view', '55', '--log-failed'],
    ]);
  });

  it('treats "no checks reported" as no checks and other failures as errors', async () => {
    respond(() => ({ exitCode: 1, stderr: 'no checks reported on the branch' }));
    const { service } = harness([]);
    expect((await service.checks('workspace-0', 1)).state).toBe('none');
    respond(() => ({ exitCode: 1, stderr: 'HTTP 401' }));
    await expect(service.checks('workspace-0', 1)).rejects.toThrow('HTTP 401');
  });
});
