import { describe, expect, it, vi } from 'vitest';

import { SubAgentWorktreeService } from '../../src/services/sub-agent-worktree-service';

import type { SubAgentOutcome, SubAgentTask } from '../../src/core/multi-agent-dag';

const task = {
  taskId: 'implement-ui',
  role: 'implementer',
  goal: 'Implement the UI',
  modelPolicy: {
    allowedProviders: ['OLLAMA'],
    allowedModels: ['qwen3:1.7b'],
    localPreferred: true,
    minimumContextTokens: 1_000,
  },
  contextNodeIds: [],
  dependencies: [],
  writeSet: ['src/ui.ts'],
  integrationSeams: [],
  worktreeId: 'agent-ui',
  budget: { maxTokens: 1_000, maxToolCalls: 10, maxRuntimeMs: 10_000, maxRetries: 0 },
  tools: ['workspace.files'],
  riskCeiling: 'R3',
  acceptanceChecks: ['UI is complete'],
  epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
} satisfies SubAgentTask;

const outcome: SubAgentOutcome = {
  taskId: task.taskId,
  status: 'succeeded',
  changedPaths: [],
  tokens: 10,
  toolCalls: 1,
  artifacts: [],
};

describe('SubAgentWorktreeService', () => {
  it('does not provision a worktree for a read-only task', async () => {
    const port = {
      prepare: vi.fn(),
      changes: vi.fn(),
      commit: vi.fn(),
      abandon: vi.fn(async () => undefined),
    };
    const service = new SubAgentWorktreeService(port);
    const readOnly = { ...task, role: 'reviewer' as const, writeSet: [] };
    const signal = new AbortController().signal;

    await service.prepare(readOnly, signal);
    await expect(service.finalize(readOnly, outcome, signal)).resolves.toMatchObject({
      changedPaths: [],
    });
    expect(port.prepare).not.toHaveBeenCalled();
    expect(port.changes).not.toHaveBeenCalled();
  });

  it('creates an isolated worktree and replaces model provenance with a host commit', async () => {
    const port = {
      prepare: vi.fn(async () => undefined),
      changes: vi.fn(async () => ['src/ui.ts']),
      commit: vi.fn(async () => '0123456789abcdef0123456789abcdef01234567'),
      abandon: vi.fn(async () => undefined),
    };
    const service = new SubAgentWorktreeService(port);
    const signal = new AbortController().signal;

    await service.prepare(task, signal);
    const verified = await service.finalize(task, outcome, signal);

    expect(port.prepare).toHaveBeenCalledWith(task, signal);
    expect(port.commit).toHaveBeenCalledWith(
      task,
      ['src/ui.ts'],
      'ClawAI sub-agent implement-ui',
      signal,
    );
    expect(verified).toMatchObject({
      commit: '0123456789abcdef0123456789abcdef01234567',
      changedPaths: ['src/ui.ts'],
    });
  });

  it('abandons a worktree that changed a path outside its declared lease', async () => {
    const port = {
      prepare: vi.fn(async () => undefined),
      changes: vi.fn(async () => ['src/other.ts']),
      commit: vi.fn(),
      abandon: vi.fn(async () => undefined),
    };
    const service = new SubAgentWorktreeService(port);
    const signal = new AbortController().signal;
    await service.prepare(task, signal);

    await expect(service.finalize(task, outcome, signal)).rejects.toThrow(/undeclared/iu);
    expect(port.commit).not.toHaveBeenCalled();
    expect(port.abandon).toHaveBeenCalledWith(task);
  });
});
