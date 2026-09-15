import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const runCommandSpec = vi.hoisted(() => vi.fn());

vi.mock('../../src/infrastructure/bounded-command-runner', () => ({ runCommandSpec }));

import { GitAgentService } from '../../src/services/git-agent-service';

const commandResult = {
  executablePath: 'git',
  executableHash: 'sha256:git',
  stdout: '',
  stderr: '',
  exitCode: 0,
  signal: null,
  startedAt: '2026-08-08T13:16:00.000Z',
  durationMs: 5,
  timedOut: false,
  cancelled: false,
  truncated: false,
};

function fakeFiles() {
  const roots = new Map<string, string>([['source', path.resolve('/repo')]]);
  return {
    workspaceRootUri: vi.fn((rootKey: string) => {
      const fsPath = roots.get(rootKey);
      if (fsPath === undefined) throw new Error('Command roots must be workspace folders');
      return { fsPath };
    }),
    registerRuntimeRoot: vi.fn((rootKey: string, rootPath: string) => {
      roots.set(rootKey, rootPath);
    }),
    unregisterRuntimeRoot: vi.fn((rootKey: string) => {
      roots.delete(rootKey);
    }),
  };
}

describe('GitAgentService worktree addressability', () => {
  beforeEach(() => {
    runCommandSpec.mockReset();
    runCommandSpec.mockResolvedValue(commandResult);
  });

  it('registers the new worktree so a later rootKey resolves to it', async () => {
    const files = fakeFiles();
    const service = new GitAgentService(
      files as never,
      vi.fn(async () => true),
    );

    await service.execute({
      rootKey: 'source',
      operation: 'create-worktree',
      path: 'wt/feature',
      branch: 'feature',
      newRootKey: 'wt-feature',
    });

    expect(files.registerRuntimeRoot).toHaveBeenCalledWith(
      'wt-feature',
      path.resolve(path.resolve('/repo'), 'wt/feature'),
    );
  });

  it('runs worktree add from the source root with the requested branch', async () => {
    const files = fakeFiles();
    const service = new GitAgentService(
      files as never,
      vi.fn(async () => true),
    );

    await service.execute({
      rootKey: 'source',
      operation: 'create-worktree',
      path: 'wt/feature',
      branch: 'feature',
      startPoint: 'main',
      newRootKey: 'wt-feature',
    });

    expect(runCommandSpec).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: 'git',
        arguments: ['worktree', 'add', '-b', 'feature', 'wt/feature', 'main'],
      }),
      path.resolve('/repo'),
      undefined,
    );
  });

  it('does not register a worktree when git worktree add fails', async () => {
    const files = fakeFiles();
    runCommandSpec.mockResolvedValueOnce({ ...commandResult, exitCode: 0 }); // before-identity rev-parse
    runCommandSpec.mockResolvedValueOnce({ ...commandResult, exitCode: 0 }); // before-identity status
    runCommandSpec.mockResolvedValueOnce({ ...commandResult, exitCode: 1, stderr: 'fatal' }); // worktree add
    const service = new GitAgentService(
      files as never,
      vi.fn(async () => true),
    );

    await expect(
      service.execute({
        rootKey: 'source',
        operation: 'create-worktree',
        path: 'wt/feature',
        branch: 'feature',
        newRootKey: 'wt-feature',
      }),
    ).rejects.toThrow();

    expect(files.registerRuntimeRoot).not.toHaveBeenCalled();
  });

  it('refuses to shadow an advertised workspace folder key', async () => {
    const files = fakeFiles();
    const service = new GitAgentService(
      files as never,
      vi.fn(async () => true),
    );

    await expect(
      service.execute({
        rootKey: 'source',
        operation: 'create-worktree',
        path: 'wt/feature',
        branch: 'feature',
        newRootKey: 'workspace-1',
      }),
    ).rejects.toThrow('newRootKey cannot reuse an advertised workspace folder key');
    expect(runCommandSpec).not.toHaveBeenCalled();
    expect(files.registerRuntimeRoot).not.toHaveBeenCalled();
  });

  it('removes a registered worktree and stops it from being addressable', async () => {
    const files = fakeFiles();
    files.registerRuntimeRoot('wt-feature', path.resolve('/repo/wt/feature'));
    const service = new GitAgentService(
      files as never,
      vi.fn(async () => true),
    );

    await service.execute({
      rootKey: 'source',
      operation: 'remove-worktree',
      worktreeRootKey: 'wt-feature',
    });

    expect(runCommandSpec).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: 'git',
        arguments: ['worktree', 'remove', '--force', path.resolve('/repo/wt/feature')],
      }),
      path.resolve('/repo'),
      undefined,
    );
    expect(files.unregisterRuntimeRoot).toHaveBeenCalledWith('wt-feature');
  });

  it('rejects removing a worktree that was never registered', async () => {
    const files = fakeFiles();
    const service = new GitAgentService(
      files as never,
      vi.fn(async () => true),
    );

    await expect(
      service.execute({
        rootKey: 'source',
        operation: 'remove-worktree',
        worktreeRootKey: 'never-registered',
      }),
    ).rejects.toThrow('Command roots must be workspace folders');
  });

  it('leaves a worktree addressable when git worktree remove fails', async () => {
    const files = fakeFiles();
    files.registerRuntimeRoot('wt-feature', path.resolve('/repo/wt/feature'));
    runCommandSpec.mockResolvedValueOnce(commandResult); // before-identity rev-parse
    runCommandSpec.mockResolvedValueOnce(commandResult); // before-identity status
    runCommandSpec.mockResolvedValueOnce({ ...commandResult, exitCode: 1, stderr: 'fatal' }); // worktree remove
    const service = new GitAgentService(
      files as never,
      vi.fn(async () => true),
    );

    await expect(
      service.execute({
        rootKey: 'source',
        operation: 'remove-worktree',
        worktreeRootKey: 'wt-feature',
      }),
    ).rejects.toThrow();

    expect(files.unregisterRuntimeRoot).not.toHaveBeenCalled();
  });
});
