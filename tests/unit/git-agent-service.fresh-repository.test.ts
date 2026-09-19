import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const runCommandSpec = vi.hoisted(() => vi.fn());

vi.mock('../../src/infrastructure/bounded-command-runner', () => ({ runCommandSpec }));

import { GitAgentService } from '../../src/services/git-agent-service';

const ok = {
  executablePath: 'git',
  executableHash: 'sha256:git',
  stdout: '',
  stderr: '',
  exitCode: 0,
  signal: null,
  startedAt: '2026-09-19T10:00:00.000Z',
  durationMs: 5,
  timedOut: false,
  cancelled: false,
  truncated: false,
};

function files() {
  return {
    workspaceRootUri: vi.fn(() => ({ fsPath: path.resolve('/repo') })),
    registerRuntimeRoot: vi.fn(),
    unregisterRuntimeRoot: vi.fn(),
  };
}

/** Answers `rev-parse HEAD` as a repository with, or without, a first commit. */
function repository(hasCommit: boolean): void {
  runCommandSpec.mockImplementation(async (spec: { arguments: string[] }) => {
    if (spec.arguments[0] === 'rev-parse' && spec.arguments[1] === 'HEAD') {
      return hasCommit
        ? { ...ok, stdout: 'a'.repeat(40) }
        : { ...ok, exitCode: 128, stderr: "fatal: ambiguous argument 'HEAD'" };
    }
    return ok;
  });
}

function gitCalls(): string[][] {
  return runCommandSpec.mock.calls.map(([spec]) => (spec as { arguments: string[] }).arguments);
}

/**
 * Git in the state an agent starts in most often: a project it just created.
 *
 * Both behaviours here were found by the extension-host lane running the real
 * tool, not by reading the code — the unit tests that existed all assumed a
 * repository with history.
 */
describe('GitAgentService in a repository with no commit yet', () => {
  beforeEach(() => {
    runCommandSpec.mockReset();
  });

  it('unstages by removing index entries, because there is no HEAD to restore from', async () => {
    repository(false);
    const service = new GitAgentService(
      files() as never,
      vi.fn(async () => true),
    );

    await service.execute({ rootKey: 'source', operation: 'unstage', paths: ['src/a.ts'] });

    expect(gitCalls()).toContainEqual(['rm', '--cached', '--quiet', '-r', '--', 'src/a.ts']);
    // `git restore --staged` resolves against HEAD and fails with "could not
    // resolve 'HEAD'" — the failure the host lane hit.
    expect(gitCalls().some((call) => call[0] === 'restore')).toBe(false);
  });

  it('still unstages with restore once the repository has a commit', async () => {
    repository(true);
    const service = new GitAgentService(
      files() as never,
      vi.fn(async () => true),
    );

    await service.execute({ rootKey: 'source', operation: 'unstage', paths: ['src/a.ts'] });

    expect(gitCalls()).toContainEqual(['restore', '--staged', '--', 'src/a.ts']);
    expect(gitCalls().some((call) => call[0] === 'rm')).toBe(false);
  });

  it('lists every untracked file rather than the directory holding them', async () => {
    // Git's default reports a new folder as "? src/", so an agent that had
    // just created three files could not see which. The service's own
    // working-tree hash already used --untracked-files=all; only the status it
    // showed the agent collapsed them.
    repository(false);
    const service = new GitAgentService(
      files() as never,
      vi.fn(async () => true),
    );

    await service.execute({ rootKey: 'source', operation: 'status' });

    expect(gitCalls()).toContainEqual([
      'status',
      '--porcelain=v2',
      '--branch',
      '--untracked-files=all',
    ]);
  });
});
