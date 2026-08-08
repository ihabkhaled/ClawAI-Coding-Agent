import { describe, expect, it, vi } from 'vitest';

import { BackendRuntimeTransport } from '../../src/infrastructure/backend-runtime-transport';
import { RuntimeEventStreamService } from '../../src/services/runtime-event-stream-service';

import type { RuntimeCommandBinding } from '../../src/backend/backend-client.types';

describe('RuntimeEventStreamService liveness', () => {
  it('surfaces a rejected dispatch while the backend sends only heartbeats', async () => {
    const invocation = runtimeInvocation('heartbeat-failure');
    const failure = new Error('Tool arguments $.content is not allowed');
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(
                event(0, 'tool.requested', {
                  invocation,
                  invocationId: invocation.invocationId,
                }),
              )}\n\ndata: ${JSON.stringify({ type: 'HEARTBEAT' })}\n\n`,
            ),
          );
        },
      }),
    );
    const abort = new AbortController();
    const following = streamService(response).follow(
      invocation.runId,
      {
        beginModelTurn: vi.fn(),
        dispatch: vi.fn(async () => Promise.reject(failure)),
        hasActiveRun: () => true,
      },
      { onEvent: vi.fn() },
      abort.signal,
    );

    try {
      const outcome = await settleWithin(following, 100);
      expect(outcome).toBe(failure);
    } finally {
      abort.abort(new Error('test cleanup'));
      try {
        streamController?.close();
      } catch {
        // The fixed stream cancels its reader before test cleanup reaches it.
      }
      await following.catch(() => undefined);
    }
  });

  it('surfaces a rejected dispatch while a reconnect is still pending', async () => {
    const invocation = runtimeInvocation('reconnect-failure');
    let rejectDispatch: ((reason: unknown) => void) | undefined;
    const dispatch = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectDispatch = reject;
        }),
    );
    let resolveReconnect: ((response: Response) => void) | undefined;
    let reconnectSignal: AbortSignal | undefined;
    let openCount = 0;
    const openRuntimeStream = vi.fn((signal: AbortSignal) => {
      openCount += 1;
      if (openCount === 1) {
        return Promise.resolve(
          new Response(
            `data: ${JSON.stringify(
              event(0, 'tool.requested', {
                invocation,
                invocationId: invocation.invocationId,
              }),
            )}\n\n`,
          ),
        );
      }
      reconnectSignal = signal;
      return new Promise<Response>((resolve) => {
        resolveReconnect = resolve;
      });
    });
    const abort = new AbortController();
    const following = streamService(openRuntimeStream).follow(
      invocation.runId,
      { beginModelTurn: vi.fn(), dispatch, hasActiveRun: () => true },
      { onEvent: vi.fn() },
      abort.signal,
    );

    await vi.waitFor(() => {
      expect(openRuntimeStream).toHaveBeenCalledTimes(2);
    });
    const failure = new Error('reject after the first stream closes');
    rejectDispatch?.(failure);
    try {
      const outcome = await settleWithin(following, 100);
      expect(outcome).toBe(failure);
      expect(reconnectSignal?.aborted).toBe(true);
      expect(reconnectSignal?.reason).toBe(failure);
    } finally {
      abort.abort(new Error('test cleanup'));
      resolveReconnect?.(new Response());
      await following.catch(() => undefined);
    }
  });

  it('does not wait for a pending dispatch or non-cooperative stream cancellation', async () => {
    const invocation = runtimeInvocation('cancel-pending');
    const abort = new AbortController();
    const encoder = new TextEncoder();
    let finishDispatch: (() => void) | undefined;
    let finishCancel: (() => void) | undefined;
    let transportSignal: AbortSignal | undefined;
    const dispatch = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDispatch = resolve;
        }),
    );
    const cancelStream = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCancel = resolve;
        }),
    );
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(
                event(0, 'tool.requested', {
                  invocation,
                  invocationId: invocation.invocationId,
                }),
              )}\n\n`,
            ),
          );
        },
        cancel: cancelStream,
      }),
    );
    const following = streamService((signal) => {
      transportSignal = signal;
      return Promise.resolve(response);
    }).follow(
      invocation.runId,
      { beginModelTurn: vi.fn(), dispatch, hasActiveRun: () => true },
      { onEvent: vi.fn() },
      abort.signal,
    );

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledTimes(1);
    });
    const cancellation = new Error('cancel the stream');
    abort.abort(cancellation);
    try {
      const outcome = await settleWithin(following, 100);
      expect(outcome).toBe(cancellation);
      expect(cancelStream).toHaveBeenCalledOnce();
      expect(transportSignal?.aborted).toBe(true);
      expect(transportSignal?.reason).toBe(cancellation);
    } finally {
      finishDispatch?.();
      finishCancel?.();
      await following.catch(() => undefined);
    }
  });

  it('surfaces a dispatch failure while a terminal event waits for pending work', async () => {
    const invocation = runtimeInvocation('terminal-failure');
    let rejectDispatch: ((reason: unknown) => void) | undefined;
    const dispatch = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectDispatch = reject;
        }),
    );
    const response = new Response(
      [
        event(0, 'tool.requested', { invocation, invocationId: invocation.invocationId }),
        event(1, 'run.completed', {}),
      ]
        .map((candidate) => `data: ${JSON.stringify(candidate)}\n\n`)
        .join(''),
    );
    const abort = new AbortController();
    const following = streamService(response).follow(
      invocation.runId,
      { beginModelTurn: vi.fn(), dispatch, hasActiveRun: () => true },
      { onEvent: vi.fn() },
      abort.signal,
    );

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledTimes(1);
    });
    const failure = new Error('terminal dispatch failed');
    rejectDispatch?.(failure);
    try {
      const outcome = await settleWithin(following, 100);
      expect(outcome).toBe(failure);
    } finally {
      abort.abort(new Error('test cleanup'));
      await following.catch(() => undefined);
    }
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

function runtimeInvocation(suffix: string) {
  return {
    schemaVersion: '2.0' as const,
    invocationId: `invocation-id-${suffix}`,
    runId: 'run-id-0001',
    turnId: `turn-id-${suffix}`,
    toolName: 'workspace.files',
    toolVersion: '2.0.0',
    operation: 'create',
    arguments: {
      rootKey: 'workspace-1',
      path: 'notes.md',
      content: 'legacy mutation shape',
    },
    targetId: 'target:workspace',
    epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
    idempotencyKey: `invocation-key-${suffix}`,
    requestedAt: '2026-08-02T10:00:04.000Z',
  };
}

function streamService(
  source: Response | ((signal: AbortSignal) => Promise<Response>),
): RuntimeEventStreamService {
  const binding: RuntimeCommandBinding = {
    threadId: 'thread-id-0001',
    runId: 'run-id-0001',
    generation: 'generation-id-0001',
    epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
  };
  return new RuntimeEventStreamService(
    new BackendRuntimeTransport(
      () => ({
        cancelRuntime: vi.fn(),
        startRuntime: vi.fn(),
        steerRuntime: vi.fn(),
        submitRuntimeResult: vi.fn(),
        openRuntimeStream: vi.fn(
          (_binding: RuntimeCommandBinding, _after: number, signal: AbortSignal) =>
            typeof source === 'function' ? source(signal) : Promise.resolve(source),
        ),
      }),
      { delete: async () => undefined, load: async () => binding, save: async () => undefined },
    ),
  );
}

async function settleWithin(promise: Promise<void>, timeoutMs: number): Promise<unknown> {
  return Promise.race([
    promise.then(
      () => 'resolved',
      (error: unknown) => error,
    ),
    new Promise<'timeout'>((resolve) => {
      setTimeout(() => {
        resolve('timeout');
      }, timeoutMs);
    }),
  ]);
}
