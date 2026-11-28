import { describe, expect, it, vi } from 'vitest';

import { isRuntimeRunEnded } from '../../src/core/runtime/runtime-event-reducer';
import {
  isTerminalRuntimeEvent,
  readRuntimeStreamEvent,
} from '../../src/core/runtime/runtime-event-stream';
import { RuntimeStreamIdleError } from '../../src/core/runtime/runtime-stream-idle';
import { RUNTIME_TERMINAL_EVENT_TYPES } from '../../src/core/runtime/runtime-terminal-events.constants';
import { HEADLESS_TERMINAL_EVENTS } from '../../src/headless/headless-session.constants';
import { BackendRuntimeTransport } from '../../src/infrastructure/backend-runtime-transport';
import { RuntimeEventStreamService } from '../../src/services/runtime-event-stream-service';

import type { RuntimeCommandBinding } from '../../src/backend/backend-client.types';

const IDLE = 1_000;
const encoder = new TextEncoder();
const HEARTBEAT = { type: 'HEARTBEAT' };
const NON_TERMINAL = [
  'run.created',
  'run.phase',
  'run.started',
  'model.delta',
  'model.summary',
  'model.turn.started',
  'reasoning.delta',
  'status.changed',
  'narration.delta',
  'text.delta',
  'run.steering.received',
];

function frame(sequence: number, type: string): object {
  return {
    schemaVersion: '2.0',
    eventId: `event-id-${String(sequence)}`,
    runId: 'run-id-0001',
    sequence,
    timestamp: '2026-11-28T10:00:00.000Z',
    type,
    visibility: 'user',
    sensitivity: 'workspace',
    epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
    payload: {},
  };
}

interface FollowState {
  settled: boolean;
  error: unknown;
}

function harness() {
  const clock = { now: 0 };
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  const binding: RuntimeCommandBinding = {
    threadId: 'thread-id-0001',
    runId: 'run-id-0001',
    generation: 'generation-id-0001',
    epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
  };
  const transport = new BackendRuntimeTransport(
    () => ({
      cancelRuntime: vi.fn(),
      startRuntime: vi.fn(),
      steerRuntime: vi.fn(),
      submitRuntimeResult: vi.fn(),
      openRuntimeStream: vi.fn(() =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controllers.push(controller);
              },
            }),
          ),
        ),
      ),
    }),
    { delete: async () => undefined, load: async () => binding, save: async () => undefined },
  );
  const service = new RuntimeEventStreamService(transport, { now: () => clock.now, idleMs: IDLE });
  const onEvent = vi.fn();
  const state: FollowState = { settled: false, error: undefined };
  const following = service
    .follow(
      'run-id-0001',
      { beginModelTurn: vi.fn(), dispatch: vi.fn(), hasActiveRun: () => true },
      { onEvent },
      new AbortController().signal,
    )
    .catch((error: unknown) => {
      state.error = error;
    })
    .finally(() => {
      state.settled = true;
    });
  const send = (index: number, ...frames: object[]): void => {
    const controller = controllers[index];
    if (controller === undefined) throw new Error('stream is not open');
    for (const next of frames) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(next)}\n\n`));
    }
  };
  const open = (count = 1): Promise<void> =>
    vi.waitFor(() => {
      expect(controllers).toHaveLength(count);
    });
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));
  return { clock, controllers, following, onEvent, open, send, settle, state };
}

describe('the run ends only on a terminal event', () => {
  it('has one terminal list that every consumer agrees with', () => {
    expect([...RUNTIME_TERMINAL_EVENT_TYPES].sort()).toEqual([
      'run.blocked',
      'run.cancelled',
      'run.completed',
      'run.failed',
    ]);
    expect([...HEADLESS_TERMINAL_EVENTS].sort()).toEqual([...RUNTIME_TERMINAL_EVENT_TYPES].sort());
    for (const type of RUNTIME_TERMINAL_EVENT_TYPES) {
      expect(isTerminalRuntimeEvent(readRuntimeStreamEvent(frame(0, type)))).toBe(true);
      expect(isRuntimeRunEnded(type)).toBe(true);
    }
  });

  it.each(NON_TERMINAL)('%s is never terminal', (type) => {
    expect(isTerminalRuntimeEvent(readRuntimeStreamEvent(frame(0, type)))).toBe(false);
    expect(isRuntimeRunEnded(type)).toBe(false);
  });

  it('keeps following through reasoning, status, narration and text events', async () => {
    const h = harness();
    await h.open();
    h.send(0, ...NON_TERMINAL.map((type, index) => frame(index, type)));
    await vi.waitFor(() => {
      expect(h.onEvent).toHaveBeenCalledTimes(NON_TERMINAL.length);
    });
    await h.settle();
    expect(h.state.settled).toBe(false);
    h.send(0, frame(NON_TERMINAL.length, 'run.completed'));
    await h.following;
    expect(h.state.error).toBeUndefined();
  });

  it.each([...RUNTIME_TERMINAL_EVENT_TYPES])('%s ends the follow at once', async (type) => {
    const h = harness();
    await h.open();
    h.send(0, frame(0, type));
    await h.following;
    expect(h.state.error).toBeUndefined();
    expect(h.onEvent).toHaveBeenCalledTimes(1);
    expect(h.controllers).toHaveLength(1);
  });

  it('ends a blocked run promptly with the blocked event delivered, not as an idle failure', async () => {
    // A denied tool: the backend sends run.blocked and then says nothing more.
    // The loop used to keep reading until two idle windows had passed.
    const h = harness();
    await h.open();
    h.send(0, frame(0, 'run.created'), frame(1, 'run.blocked'));
    await h.following;
    expect(h.state.error).toBeUndefined();
    expect(h.state.error).not.toBeInstanceOf(RuntimeStreamIdleError);
    expect(h.onEvent.mock.calls.map(([event]) => (event as { type: string }).type)).toEqual([
      'run.created',
      'run.blocked',
    ]);
  });
});

describe('the idle window as it stands', () => {
  it('is held open by non-heartbeat status events, not by heartbeats', async () => {
    const h = harness();
    await h.open();
    for (let sequence = 0; sequence < 4; sequence += 1) {
      h.clock.now += IDLE - 1;
      h.send(0, frame(sequence, 'status.changed'), HEARTBEAT);
      await vi.waitFor(() => {
        expect(h.onEvent).toHaveBeenCalledTimes(sequence + 1);
      });
    }
    await h.settle();
    expect(h.controllers).toHaveLength(1);
    expect(h.state.settled).toBe(false);
    h.send(0, frame(4, 'run.failed'));
    await h.following;
  });

  it('re-attaches once after a silent window and fails on the second', async () => {
    const h = harness();
    await h.open();
    h.clock.now = IDLE;
    h.send(0, HEARTBEAT);
    await h.open(2);
    h.clock.now = IDLE * 2;
    h.send(1, HEARTBEAT);
    await h.following;
    expect(h.state.error).toBeInstanceOf(RuntimeStreamIdleError);
  });
});
