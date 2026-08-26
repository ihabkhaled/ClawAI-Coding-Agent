import { describe, expect, it, vi } from 'vitest';

import { RuntimeRunEndedError } from '../../src/core/runtime/runtime-invocation-registry';
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
      event(8, 'tool.requested', {
        invocationId: invocation.invocationId,
        invocation,
        operation: invocation.operation,
        toolName: invocation.toolName,
      }),
      event(9, 'run.completed', {}),
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
      hasActiveRun: () => true,
    };
    const observed = vi.fn();

    await new RuntimeEventStreamService(transport).follow(
      invocation.runId,
      runtime,
      { onEvent: observed },
      new AbortController().signal,
      7,
    );

    expect(observed).toHaveBeenCalledTimes(2);
    expect(runtime.dispatch).toHaveBeenCalledTimes(1);
    expect(runtime.dispatch).toHaveBeenCalledWith(
      invocation,
      expect.objectContaining({ action: 'continue' }),
    );
    expect(backend.openRuntimeStream).toHaveBeenCalledWith(binding, 7, expect.any(AbortSignal));
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
      { beginModelTurn: vi.fn(), dispatch, hasActiveRun: () => true },
      { onEvent: observed },
      new AbortController().signal,
    );

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(observed).toHaveBeenCalledTimes(3);
    completeDispatch?.();
    await following;
  });

  it('stops instead of dispatching into a run that has already ended', async () => {
    // The backend keeps streaming until it learns the run ended on this side.
    // Those late frames used to be handed to beginModelTurn, which threw "No
    // runtime run is active" — and that sentence was shown to the user as the
    // assistant's answer.
    const invocation = {
      schemaVersion: '2.0' as const,
      invocationId: 'invocation-id-0002',
      runId: 'run-id-0001',
      turnId: 'turn-id-0002',
      toolName: 'workspace.files',
      toolVersion: '2.0.0',
      operation: 'read',
      arguments: { rootKey: 'workspace-root', path: 'README.md' },
      targetId: 'target:workspace',
      epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
      idempotencyKey: 'invocation-key-0002',
      requestedAt: '2026-08-02T10:00:02.000Z',
    };
    const backend = {
      cancelRuntime: vi.fn(),
      startRuntime: vi.fn(),
      steerRuntime: vi.fn(),
      submitRuntimeResult: vi.fn(),
      openRuntimeStream: vi.fn(
        async () =>
          new Response(
            `data: ${JSON.stringify(
              event(0, 'tool.requested', {
                invocationId: invocation.invocationId,
                invocation,
                operation: invocation.operation,
                toolName: invocation.toolName,
              }),
            )}\n\n`,
          ),
      ),
    };
    const transport = new BackendRuntimeTransport(() => backend, {
      delete: async () => undefined,
      load: async () => ({
        threadId: 'thread-id-0001',
        runId: 'run-id-0001',
        generation: 'generation-id-0001',
        epochs: invocation.epochs,
      }),
      save: async () => undefined,
    });
    const runtime = {
      beginModelTurn: vi.fn(),
      dispatch: vi.fn(async () => ({ status: 'succeeded' })),
      hasActiveRun: () => false,
    };

    await expect(
      new RuntimeEventStreamService(transport).follow(
        invocation.runId,
        runtime,
        { onEvent: vi.fn() },
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
    expect(runtime.beginModelTurn).not.toHaveBeenCalled();
    expect(runtime.dispatch).not.toHaveBeenCalled();
  });
  it('stops when the turn opens on a run that ended a moment ago', async () => {
    // The step just dispatched was denied or blocked, so the registry closed
    // between the frame arriving and this turn opening. The sentence that used
    // to be raised here reached the user as the assistant's whole answer: an
    // Enterprise-locked run replied "Runtime invocation registry is terminal".
    const invocation = {
      schemaVersion: '2.0' as const,
      invocationId: 'invocation-id-0003',
      runId: 'run-id-0001',
      turnId: 'turn-id-0003',
      toolName: 'workspace.files',
      toolVersion: '2.0.0',
      operation: 'read',
      arguments: { rootKey: 'workspace-root', path: 'README.md' },
      targetId: 'target:workspace',
      epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
      idempotencyKey: 'invocation-key-0003',
      requestedAt: '2026-08-02T10:00:03.000Z',
    };
    const backend = {
      cancelRuntime: vi.fn(),
      startRuntime: vi.fn(),
      steerRuntime: vi.fn(),
      submitRuntimeResult: vi.fn(),
      openRuntimeStream: vi.fn(
        async () =>
          new Response(
            `data: ${JSON.stringify(
              event(0, 'tool.requested', {
                invocationId: invocation.invocationId,
                invocation,
                operation: invocation.operation,
                toolName: invocation.toolName,
              }),
            )}

`,
          ),
      ),
    };
    const transport = new BackendRuntimeTransport(() => backend, {
      delete: async () => undefined,
      load: async () => ({
        threadId: 'thread-id-0001',
        runId: 'run-id-0001',
        generation: 'generation-id-0001',
        epochs: invocation.epochs,
      }),
      save: async () => undefined,
    });
    const dispatch = vi.fn(async () => ({ status: 'succeeded' }));

    await expect(
      new RuntimeEventStreamService(transport).follow(
        invocation.runId,
        {
          beginModelTurn: vi.fn(() => {
            throw new RuntimeRunEndedError();
          }),
          dispatch,
          hasActiveRun: () => true,
        },
        { onEvent: vi.fn() },
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
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
