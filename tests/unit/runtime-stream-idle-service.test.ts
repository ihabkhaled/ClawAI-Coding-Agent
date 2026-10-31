import { describe, expect, it, vi } from 'vitest';

import { RuntimeStreamIdleError } from '../../src/core/runtime/runtime-stream-idle';
import { BackendRuntimeTransport } from '../../src/infrastructure/backend-runtime-transport';
import { RuntimeEventStreamService } from '../../src/services/runtime-event-stream-service';

import type { RuntimeCommandBinding } from '../../src/backend/backend-client.types';

const IDLE = 1_000;
const encoder = new TextEncoder();

interface Harness {
  readonly clock: { now: number };
  readonly controllers: ReadableStreamDefaultController<Uint8Array>[];
  readonly afters: number[];
  readonly service: RuntimeEventStreamService;
  send(index: number, ...frames: object[]): void;
}

function harness(): Harness {
  const clock = { now: 0 };
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  const afters: number[] = [];
  const binding: RuntimeCommandBinding = {
    threadId: 'thread-id-0001',
    runId: 'run-id-0001',
    generation: 'generation-id-0001',
    epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
  };
  const service = new RuntimeEventStreamService(
    new BackendRuntimeTransport(
      () => ({
        cancelRuntime: vi.fn(),
        startRuntime: vi.fn(),
        steerRuntime: vi.fn(),
        submitRuntimeResult: vi.fn(),
        openRuntimeStream: vi.fn((_binding: RuntimeCommandBinding, after: number) => {
          afters.push(after);
          return Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controllers.push(controller);
                },
              }),
            ),
          );
        }),
      }),
      { delete: async () => undefined, load: async () => binding, save: async () => undefined },
    ),
    { now: () => clock.now, idleMs: IDLE },
  );
  return {
    clock,
    controllers,
    afters,
    service,
    send(index, ...frames) {
      const controller = controllers[index];
      if (controller === undefined) throw new Error(`stream ${String(index)} is not open`);
      for (const frame of frames) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      }
    },
  };
}

const heartbeat = { type: 'HEARTBEAT' };

describe('RuntimeEventStreamService idle watchdog', () => {
  it('reattaches once from the cursor, then fails with the typed error', async () => {
    const h = harness();
    const abort = new AbortController();
    const onEvent = vi.fn();
    const following = h.service.follow(
      'run-id-0001',
      { beginModelTurn: vi.fn(), dispatch: vi.fn(), hasActiveRun: () => true },
      { onEvent },
      abort.signal,
    );
    const outcome = following.then(
      () => undefined,
      (error: unknown) => error,
    );

    await vi.waitFor(() => {
      expect(h.controllers).toHaveLength(1);
    });
    h.send(0, event(0, 'run.started', {}), heartbeat);
    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledTimes(1);
    });
    h.clock.now = IDLE;
    h.send(0, heartbeat);

    await vi.waitFor(() => {
      expect(h.controllers).toHaveLength(2);
    });
    expect(h.afters).toEqual([-1, 0]);
    h.clock.now = IDLE * 2;
    h.send(1, heartbeat);

    const error = await outcome;
    expect(error).toBeInstanceOf(RuntimeStreamIdleError);
    expect((error as Error).message).toBe('The run stopped responding');
    expect(h.controllers).toHaveLength(2);
    expect(abort.signal.aborted).toBe(false);
  });

  it('never trips while real events keep arriving, even across heartbeats', async () => {
    const h = harness();
    const onEvent = vi.fn();
    const following = h.service.follow(
      'run-id-0001',
      { beginModelTurn: vi.fn(), dispatch: vi.fn(), hasActiveRun: () => true },
      { onEvent },
      new AbortController().signal,
    );
    await vi.waitFor(() => {
      expect(h.controllers).toHaveLength(1);
    });
    for (let sequence = 0; sequence < 5; sequence += 1) {
      h.clock.now += IDLE - 1;
      h.send(0, heartbeat, event(sequence, 'run.started', {}));
      await vi.waitFor(() => {
        expect(onEvent).toHaveBeenCalledTimes(sequence + 1);
      });
    }
    h.send(0, event(5, 'run.completed', {}));
    await expect(following).resolves.toBeUndefined();
    expect(h.controllers).toHaveLength(1);
  });

  it('does not count a tool call in flight as idle', async () => {
    const h = harness();
    const invocation = runtimeInvocation();
    let finishDispatch: () => void = () => undefined;
    const dispatch = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDispatch = resolve;
        }),
    );
    const following = h.service.follow(
      'run-id-0001',
      { beginModelTurn: vi.fn(), dispatch, hasActiveRun: () => true },
      { onEvent: vi.fn() },
      new AbortController().signal,
    );
    await vi.waitFor(() => {
      expect(h.controllers).toHaveLength(1);
    });
    h.send(
      0,
      event(0, 'tool.requested', { invocation, invocationId: invocation.invocationId }),
      heartbeat,
    );
    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledTimes(1);
    });
    for (let beat = 0; beat < 5; beat += 1) {
      h.clock.now += IDLE * 3;
      h.send(0, heartbeat);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(h.controllers).toHaveLength(1);
    finishDispatch();
    h.send(0, event(1, 'run.completed', {}));
    await expect(following).resolves.toBeUndefined();
    expect(h.controllers).toHaveLength(1);
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

function runtimeInvocation() {
  return {
    schemaVersion: '2.0' as const,
    invocationId: 'invocation-id-idle',
    runId: 'run-id-0001',
    turnId: 'turn-id-idle',
    toolName: 'workspace.files',
    toolVersion: '2.0.0',
    operation: 'create',
    arguments: { rootKey: 'workspace-1', path: 'notes.md', content: 'x' },
    targetId: 'target:workspace',
    epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
    idempotencyKey: 'invocation-key-idle',
    requestedAt: '2026-08-02T10:00:04.000Z',
  };
}
