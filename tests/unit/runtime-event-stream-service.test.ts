import { describe, expect, it, vi } from 'vitest';

import { BackendRuntimeTransport } from '../../src/infrastructure/backend-runtime-transport';
import { RuntimeEventStreamService } from '../../src/services/runtime-event-stream-service';

import type { RuntimeCommandBinding } from '../../src/backend/backend-client.types';

describe('RuntimeEventStreamService backend event integration', () => {
  it('observes and dispatches one canonical backend tool request without shape loss', async () => {
    const invocation = {
      schemaVersion: '2.0' as const,
      invocationId: 'invocation-id-0001',
      runId: 'run-id-0001',
      turnId: 'turn-id-0001',
      toolName: 'workspace.files',
      toolVersion: '2.0.0',
      operation: 'read',
      arguments: { rootKey: 'workspace-root', path: 'README.md' },
      targetId: 'target:workspace',
      epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
      idempotencyKey: 'invocation-key-0001',
      requestedAt: '2026-08-02T10:00:01.000Z',
    };
    const events = [
      event(0, 'tool.requested', {
        invocationId: invocation.invocationId,
        invocation,
        operation: invocation.operation,
        toolName: invocation.toolName,
      }),
      event(1, 'run.completed', {}),
    ];
    const binding: RuntimeCommandBinding = {
      threadId: 'thread-id-0001',
      runId: 'run-id-0001',
      generation: 'generation-id-0001',
      epochs: invocation.epochs,
    };
    const backend = {
      cancelRuntime: vi.fn(),
      startRuntime: vi.fn(),
      steerRuntime: vi.fn(),
      submitRuntimeResult: vi.fn(),
      openRuntimeStream: vi.fn(
        async () =>
          new Response(
            events.map((candidate) => `data: ${JSON.stringify(candidate)}\n\n`).join(''),
          ),
      ),
    };
    const transport = new BackendRuntimeTransport(() => backend, {
      delete: async () => undefined,
      load: async () => binding,
      save: async () => undefined,
    });
    const runtime = {
      beginModelTurn: vi.fn(() => ({ runId: invocation.runId })),
      dispatch: vi.fn(async () => ({ status: 'succeeded' })),
    };
    const observed = vi.fn();

    await new RuntimeEventStreamService(transport).follow(
      invocation.runId,
      runtime,
      { onEvent: observed },
      new AbortController().signal,
    );

    expect(observed).toHaveBeenCalledTimes(2);
    expect(runtime.dispatch).toHaveBeenCalledTimes(1);
    expect(runtime.dispatch).toHaveBeenCalledWith(
      invocation,
      expect.objectContaining({ action: 'continue' }),
    );
  });

  it('continues consuming steering while a long-running tool remains active', async () => {
    let completeDispatch: (() => void) | undefined;
    const dispatch = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completeDispatch = resolve;
        }),
    );
    const invocation = {
      schemaVersion: '2.0' as const,
      invocationId: 'invocation-id-steering',
      runId: 'run-id-0001',
      turnId: 'turn-id-steering',
      toolName: 'runtime.flagship',
      toolVersion: '2.0.0',
      operation: 'run',
      arguments: { request: {} },
      targetId: 'target:workspace',
      epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
      idempotencyKey: 'invocation-key-steering',
      requestedAt: '2026-08-02T10:00:01.000Z',
    };
    const response = new Response(
      [
        event(0, 'tool.requested', { invocation, invocationId: invocation.invocationId }),
        event(1, 'steering.received', { message: 'Prioritize the regression.' }),
        event(2, 'run.completed', {}),
      ]
        .map((candidate) => `data: ${JSON.stringify(candidate)}\n\n`)
        .join(''),
    );
    const binding: RuntimeCommandBinding = {
      threadId: 'thread-id-0001',
      runId: 'run-id-0001',
      generation: 'generation-id-0001',
      epochs: invocation.epochs,
    };
    const transport = new BackendRuntimeTransport(
      () => ({
        cancelRuntime: vi.fn(),
        startRuntime: vi.fn(),
        steerRuntime: vi.fn(),
        submitRuntimeResult: vi.fn(),
        openRuntimeStream: vi.fn(async () => response),
      }),
      { delete: async () => undefined, load: async () => binding, save: async () => undefined },
    );
    const observed = vi.fn();
    const following = new RuntimeEventStreamService(transport).follow(
      invocation.runId,
      { beginModelTurn: vi.fn(), dispatch },
      { onEvent: observed },
      new AbortController().signal,
    );

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(observed).toHaveBeenCalledTimes(3);
    completeDispatch?.();
    await following;
  });
});

function event(sequence: number, type: string, payload: Record<string, unknown>): object {
  return {
    schemaVersion: '2.0',
    eventId: `event-id-${String(sequence)}`,
    runId: 'run-id-0001',
    sequence,
    timestamp: `2026-08-02T10:00:0${String(sequence)}.000Z`,
    type,
    visibility: 'user',
    sensitivity: 'workspace',
    epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
    payload,
  };
}
