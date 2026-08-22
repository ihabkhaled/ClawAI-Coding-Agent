import { describe, expect, it, vi } from 'vitest';

import { FileLeaseManager } from '../../src/services/file-lease-manager';
import { SubAgentCoordinatorService } from '../../src/services/sub-agent-coordinator-service';
import {
  failedOutcome,
  subAgentEpochs,
  subAgentTask,
  successfulOutcome,
} from '../helpers/sub-agent';

import type { SubAgentTask, SubAgentTaskStatus } from '../../src/core/multi-agent-dag';

interface RecordedStatus {
  readonly taskId: string;
  readonly status: SubAgentTaskStatus;
  readonly detail: string | undefined;
}

function coordinator(
  execute: (
    task: SubAgentTask,
    steering: () => readonly string[],
    signal: AbortSignal,
  ) => Promise<ReturnType<typeof successfulOutcome>>,
  statuses: RecordedStatus[] = [],
): SubAgentCoordinatorService {
  return new SubAgentCoordinatorService({ execute }, new FileLeaseManager(), () => subAgentEpochs, {
    status: (taskId, status, detail) => statuses.push({ taskId, status, detail }),
    outcome: () => undefined,
  });
}

function graph(task: SubAgentTask) {
  return {
    graphId: 'graph-recovery-ladder',
    parentRunId: 'runtime-parent-0001',
    maxConcurrency: 1,
    tasks: [task],
  };
}

describe('SubAgentCoordinatorService recovery', () => {
  it('retries a transient in-band failure and succeeds with a changed strategy', async () => {
    let attempts = 0;
    const execute = vi.fn(async (task: SubAgentTask) => {
      attempts += 1;
      return attempts === 1
        ? failedOutcome(task.taskId, 'Nested runtime failed: none (CLOUD_PROVIDER_EMPTY_RESPONSE)')
        : successfulOutcome(task.taskId);
    });
    const retryable = subAgentTask('implement-api', [], ['src/api.ts'], 'implementer');

    const [outcome] = await coordinator(execute).run(
      graph({ ...retryable, budget: { ...retryable.budget, maxRetries: 2 } }),
    );

    expect(execute).toHaveBeenCalledTimes(2);
    expect(outcome?.status).toBe('succeeded');
  });

  it('records the chosen recovery strategy before each retry', async () => {
    const statuses: RecordedStatus[] = [];
    let attempts = 0;
    const execute = vi.fn(async (task: SubAgentTask) => {
      attempts += 1;
      return attempts === 1
        ? failedOutcome(task.taskId, 'Nested runtime failed: bad (MODEL_TOOL_REQUEST_UNREPAIRABLE)')
        : successfulOutcome(task.taskId);
    });
    const retryable = subAgentTask('implement-api', [], ['src/api.ts'], 'implementer');

    await coordinator(execute, statuses).run(
      graph({ ...retryable, budget: { ...retryable.budget, maxRetries: 2 } }),
    );

    expect(statuses.map(({ detail }) => detail)).toContain(
      'malformed-tool-output attempt 1 resolved to retry-constrained',
    );
  });

  it('stops at the task retry budget even while the ladder still offers a strategy', async () => {
    const execute = vi.fn(async (task: SubAgentTask) =>
      failedOutcome(task.taskId, 'Nested runtime failed: none (CLOUD_PROVIDER_EMPTY_RESPONSE)'),
    );
    const retryable = subAgentTask('implement-api', [], ['src/api.ts'], 'implementer');

    const [outcome] = await coordinator(execute).run(
      graph({ ...retryable, budget: { ...retryable.budget, maxRetries: 1 } }),
    );

    expect(execute).toHaveBeenCalledTimes(2);
    expect(outcome?.status).toBe('failed');
  });

  it('abandons a repeating hypothesis rather than exhausting a generous retry budget', async () => {
    const execute = vi.fn(async (task: SubAgentTask) =>
      failedOutcome(task.taskId, 'Nested runtime failed: none (CLOUD_PROVIDER_EMPTY_RESPONSE)'),
    );
    const retryable = subAgentTask('implement-api', [], ['src/api.ts'], 'implementer');

    const [outcome] = await coordinator(execute).run(
      graph({ ...retryable, budget: { ...retryable.budget, maxRetries: 5 } }),
    );

    expect(execute).toHaveBeenCalledTimes(3);
    expect(outcome?.status).toBe('failed');
  });

  it('still refuses to replay an ambiguous mutation whatever the retry budget allows', async () => {
    const execute = vi.fn(async () => Promise.reject(new Error('response lost')));
    const mutating = subAgentTask('effectful-task', [], ['src/effect.ts'], 'implementer');

    const [outcome] = await coordinator(execute).run(
      graph({ ...mutating, budget: { ...mutating.budget, maxRetries: 3 } }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(outcome?.status).toBe('failed');
  });

  it('retries a thrown read-only task because it cannot have mutated anything', async () => {
    let attempts = 0;
    const execute = vi.fn(async (task: SubAgentTask) => {
      attempts += 1;
      if (attempts === 1) throw new Error('response lost');
      return successfulOutcome(task.taskId);
    });
    const readOnly = subAgentTask('inspect-code', [], [], 'explorer');

    const [outcome] = await coordinator(execute).run(
      graph({ ...readOnly, budget: { ...readOnly.budget, maxRetries: 2 } }),
    );

    expect(execute).toHaveBeenCalledTimes(2);
    expect(outcome?.status).toBe('succeeded');
  });

  it('terminates instead of re-queueing a task once the graph is stopping', async () => {
    const coordinatorRef: { current?: SubAgentCoordinatorService } = {};
    const execute = vi.fn(async (task: SubAgentTask) => {
      coordinatorRef.current?.cancelAll();
      return failedOutcome(
        task.taskId,
        'Nested runtime failed: none (CLOUD_PROVIDER_EMPTY_RESPONSE)',
      );
    });
    const retryable = subAgentTask('implement-api', [], ['src/api.ts'], 'implementer');
    const service = coordinator(execute);
    coordinatorRef.current = service;

    const outcomes = await service.run(
      graph({ ...retryable, budget: { ...retryable.budget, maxRetries: 5 } }),
    );

    expect(outcomes[0]?.status).toBe('failed');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('reports the budget every attempt spent, not only the last one', async () => {
    let attempts = 0;
    const execute = vi.fn(async (task: SubAgentTask) => {
      attempts += 1;
      return attempts === 1
        ? {
            ...failedOutcome(
              task.taskId,
              'Nested runtime failed: none (CLOUD_PROVIDER_EMPTY_RESPONSE)',
            ),
            tokens: 40,
            toolCalls: 3,
            modelTurns: 2,
          }
        : { ...successfulOutcome(task.taskId), tokens: 10, toolCalls: 1, modelTurns: 1 };
    });
    const retryable = subAgentTask('implement-api', [], ['src/api.ts'], 'implementer');

    const [outcome] = await coordinator(execute).run(
      graph({ ...retryable, budget: { ...retryable.budget, maxRetries: 2, maxTokens: 1_000 } }),
    );

    expect(outcome).toMatchObject({ tokens: 50, toolCalls: 4, modelTurns: 3, attempts: 2 });
  });

  it('does not retry a blocked task, which failed on policy rather than transport', async () => {
    const execute = vi.fn(async (task: SubAgentTask) => ({
      ...failedOutcome(task.taskId, 'Refused'),
      status: 'blocked' as const,
    }));
    const blocked = subAgentTask('implement-api', [], ['src/api.ts'], 'implementer');

    const [outcome] = await coordinator(execute).run(
      graph({ ...blocked, budget: { ...blocked.budget, maxRetries: 3 } }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(outcome?.status).toBe('blocked');
  });

  it('spends one runtime ceiling across every attempt rather than re-arming it', async () => {
    const abortedOnAttempt: boolean[] = [];
    let attempts = 0;
    const execute = vi.fn(
      async (task: SubAgentTask, _steering: () => readonly string[], signal: AbortSignal) => {
        attempts += 1;
        if (attempts === 1) {
          // Burn most of the ceiling, then fail in a way the ladder retries.
          await new Promise((resolve) => setTimeout(resolve, 700));
          abortedOnAttempt.push(signal.aborted);
          return failedOutcome(
            task.taskId,
            'Nested runtime failed: none (CLOUD_PROVIDER_EMPTY_RESPONSE)',
          );
        }
        // Re-arming would hand this attempt another full allowance. Inheriting
        // the remainder instead means it starts already out of time.
        await new Promise((resolve) => setTimeout(resolve, 600));
        abortedOnAttempt.push(signal.aborted);
        return successfulOutcome(task.taskId);
      },
    );
    const retryable = subAgentTask('implement-api', [], ['src/api.ts'], 'implementer');

    await coordinator(execute).run(
      graph({
        ...retryable,
        budget: { ...retryable.budget, maxRetries: 2, maxRuntimeMs: 1_000 },
      }),
    );

    expect(attempts).toBeGreaterThan(1);
    expect(abortedOnAttempt[1]).toBe(true);
  });
});
