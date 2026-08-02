import { describe, expect, it, vi } from 'vitest';

import { IntegrationCoordinatorService } from '../../src/services/integration-coordinator-service';

const request = {
  integrationId: 'integration-test-0001',
  targetWorktreeId: 'target-worktree',
  commits: [
    {
      taskId: 'task-a',
      worktreeId: 'worktree-a',
      commit: 'a'.repeat(40),
      changedPaths: ['src/a.ts'],
      integrationSeams: ['runtime-api'],
    },
    {
      taskId: 'task-b',
      worktreeId: 'worktree-b',
      commit: 'b'.repeat(40),
      changedPaths: ['src/b.ts'],
      integrationSeams: ['extension-ui'],
    },
  ],
  mandatoryGateIds: ['project:unit:0'],
};

describe('IntegrationCoordinatorService', () => {
  it('integrates deterministic commits and reruns mandatory gates', async () => {
    const fingerprints = ['clean', 'clean', 'after-a', 'after-a', 'after-b'];
    const git = {
      workingFingerprint: vi.fn(async () => fingerprints.shift() ?? 'after-b'),
      verifyCommit: vi.fn(async () => true),
      cherryPick: vi.fn(async () => ({ conflicts: [] })),
      abortCherryPick: vi.fn(async () => undefined),
      releaseWorktree: vi.fn(async () => undefined),
    };
    const quality = {
      run: vi.fn(async () => [{ gateId: 'project:unit:0', passed: true }]),
    };

    await expect(
      new IntegrationCoordinatorService(git, quality).integrate(request),
    ).resolves.toEqual({
      integrationId: request.integrationId,
      status: 'integrated',
      integratedCommits: request.commits.map(({ commit }) => commit),
      conflicts: [],
      semanticConflicts: [],
      gates: [{ gateId: 'project:unit:0', passed: true }],
    });
    expect(git.cherryPick).toHaveBeenCalledTimes(2);
    expect(git.releaseWorktree).toHaveBeenCalledTimes(2);
    expect(git.releaseWorktree).toHaveBeenNthCalledWith(1, 'worktree-a');
    expect(git.releaseWorktree).toHaveBeenNthCalledWith(2, 'worktree-b');
    expect(quality.run).toHaveBeenCalledWith('target-worktree', ['project:unit:0'], undefined);
  });

  it('stops when the target worktree changes between reviewed picks', async () => {
    const fingerprints = ['clean', 'clean', 'after-a', 'changed-externally'];
    const git = {
      workingFingerprint: vi.fn(async () => fingerprints.shift() ?? 'changed-externally'),
      verifyCommit: vi.fn(async () => true),
      cherryPick: vi.fn(async () => ({ conflicts: [] })),
      abortCherryPick: vi.fn(async () => undefined),
      releaseWorktree: vi.fn(async () => undefined),
    };
    const quality = { run: vi.fn(async () => []) };

    await expect(
      new IntegrationCoordinatorService(git, quality).integrate(request),
    ).rejects.toThrow(/changed after integration review/iu);
    expect(git.cherryPick).toHaveBeenCalledTimes(1);
    expect(quality.run).not.toHaveBeenCalled();
  });

  it('reports semantic collisions without mutating Git', async () => {
    const git = {
      workingFingerprint: vi.fn(async () => 'clean'),
      verifyCommit: vi.fn(async () => true),
      cherryPick: vi.fn(async () => ({ conflicts: [] })),
      abortCherryPick: vi.fn(async () => undefined),
      releaseWorktree: vi.fn(async () => undefined),
    };
    const quality = { run: vi.fn(async () => []) };
    const collision = {
      ...request,
      commits: [request.commits[0], { ...request.commits[1], changedPaths: ['src/a.ts'] }],
    };

    const receipt = await new IntegrationCoordinatorService(git, quality).integrate(collision);
    expect(receipt.status).toBe('conflict');
    expect(receipt.semanticConflicts).toEqual(['src/a.ts: task-a and task-b']);
    expect(git.cherryPick).not.toHaveBeenCalled();
  });

  it('rejects a commit whose real worktree diff does not match its declaration', async () => {
    const git = {
      workingFingerprint: vi.fn(async () => 'clean'),
      verifyCommit: vi.fn(async () => false),
      cherryPick: vi.fn(async () => ({ conflicts: [] })),
      abortCherryPick: vi.fn(async () => undefined),
      releaseWorktree: vi.fn(async () => undefined),
    };
    const quality = { run: vi.fn(async () => []) };

    await expect(
      new IntegrationCoordinatorService(git, quality).integrate(request),
    ).rejects.toThrow(/provenance is invalid/iu);
    expect(git.cherryPick).not.toHaveBeenCalled();
  });
});
