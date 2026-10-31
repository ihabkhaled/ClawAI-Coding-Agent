import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackendClient } from '../../src/backend/backend-client';
import { RuntimeStuckError } from '../../src/core/runtime/runtime-repetition';
import { RuntimeStreamIdleError } from '../../src/core/runtime/runtime-stream-idle';
import { SessionVault } from '../../src/core/session-vault';
import { BackendRuntimeTransport } from '../../src/infrastructure/backend-runtime-transport';
import { RuntimeEventStreamService } from '../../src/services/runtime-event-stream-service';
import { RuntimeRunService } from '../../src/services/runtime-run-service';
import { closePanelMocks, RUN_ID, startMock } from '../helpers/panel-runtime-mock';

import type { RuntimeCommandBinding } from '../../src/backend/backend-client.types';
import type { RuntimeEvent } from '../../src/core/runtime/runtime-protocol.schemas';
import type {
  RuntimeJsonObject,
  ToolInvocation,
} from '../../src/core/runtime/runtime-tool-contracts';
import type { SecretStoragePort } from '../../src/core/session-vault';
import type { RuntimeRunStart } from '../../src/services/runtime-run-service';
import type { Mock } from '../helpers/panel-runtime-mock';

const epochs = { account: 1, workspace: 2, target: 3, policy: 4 };
const TURN_ID = 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ';
const definition = {
  schemaVersion: '2.0' as const,
  name: 'workspace.files',
  version: '1.0',
  description: 'Files in the workspace.',
  operations: ['list', 'create'],
  riskClasses: ['inspect' as const],
  targetIds: ['target:primary'],
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['path'],
    properties: { path: { type: 'string' } },
  },
};
const budget = {
  maxModelTurns: 100,
  maxToolCalls: 100,
  maxToolRounds: 100,
  maxRepairAttempts: 1,
  maxRuntimeMs: 600_000,
  maxOutputBytes: 1_000_000,
  maxToolResultBytes: 1_000_000,
};
const START: RuntimeRunStart = {
  budget,
  definitions: [definition],
  epochs,
  threadId: 'thread_01JZZZZZZZZZZZZZZZZZZZZZ',
  clientRequestId: 'request_01JZZZZZZZZZZZZZZZZZZZZ',
  idempotencyKey: 'start_01JZZZZZZZZZZZZZZZZZZZZZZ',
  prompt: 'Look around.',
  manifestHash: `sha256:${'1'.repeat(64)}`,
  toolCatalogHash: `sha256:${'2'.repeat(64)}`,
  provider: 'fixture',
  model: 'fixture-model',
  runId: RUN_ID,
  turnId: TURN_ID,
};
const keep = { action: 'continue' as const, nextTurnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZY' };

class MemorySecretStorage implements SecretStoragePort {
  private readonly values = new Map<string, string>();
  get(key: string): Thenable<string | undefined> {
    return Promise.resolve(this.values.get(key));
  }
  store(key: string, value: string): Thenable<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
  delete(key: string): Thenable<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

interface Panel {
  readonly mock: Mock;
  readonly backend: BackendClient;
  readonly transport: BackendRuntimeTransport;
  readonly service: RuntimeRunService;
  readonly events: RuntimeEvent[];
  readonly sleeps: number[];
  readonly executed: ToolInvocation[];
  readonly clock: { now: number };
  readonly stream: (idleMs?: number) => RuntimeEventStreamService;
}

async function panel(execute?: (call: ToolInvocation) => Promise<void>): Promise<Panel> {
  const mock = await startMock();
  const vault = new SessionVault(new MemorySecretStorage());
  await vault.save(mock.url, {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresIn: 900,
    refreshExpiresIn: 2_592_000,
    tokenType: 'Bearer',
  });
  const sleeps: number[] = [];
  const clock = { now: 0 };
  const backend = new BackendClient({
    backendUrl: mock.url,
    timeoutMs: 5_000,
    sessionVault: vault,
    retry: {
      now: () => clock.now,
      random: () => 0.5,
      sleep: (ms) => {
        sleeps.push(ms);
        clock.now += ms;
        return Promise.resolve();
      },
    },
  });
  const stored = new Map<string, RuntimeCommandBinding>();
  const transport = new BackendRuntimeTransport(() => backend, {
    delete: async (runId) => {
      stored.delete(runId);
    },
    load: async (runId) => stored.get(runId),
    save: async (saved) => {
      stored.set(saved.runId, saved);
    },
  });
  const events: RuntimeEvent[] = [];
  const executed: ToolInvocation[] = [];
  let receipts = 0;
  const service = new RuntimeRunService({
    clock: { now: () => Date.now() },
    currentEpochs: () => epochs,
    eventSink: { publishBatch: (batch) => events.push(...batch) },
    executor: {
      execute: async (call) => {
        executed.push(call);
        await execute?.(call);
        return { structured: { files: 3 }, modelText: 'three files' };
      },
    },
    policy: { evaluate: async () => ({ decision: 'allow' as const, code: 'OK', message: 'ok' }) },
    receiptId: () => {
      receipts += 1;
      return `receipt_01JZZZZZZZZZZZZZZZZZZZ${String(receipts).padStart(3, '0')}`;
    },
    transport,
  });
  return {
    mock,
    backend,
    transport,
    service,
    events,
    sleeps,
    executed,
    clock,
    stream: (idleMs) =>
      new RuntimeEventStreamService(
        transport,
        idleMs === undefined ? {} : { now: () => clock.now, idleMs },
      ),
  };
}

let counter = 0;
function call(operation: string, args: RuntimeJsonObject, turnId = TURN_ID): ToolInvocation {
  counter += 1;
  const id = String(counter).padStart(3, '0');
  return {
    schemaVersion: '2.0',
    invocationId: `inv_01JZZZZZZZZZZZZZZZZZZZZ${id}`,
    runId: RUN_ID,
    turnId,
    toolName: definition.name,
    toolVersion: definition.version,
    operation,
    arguments: args,
    targetId: 'target:primary',
    epochs,
    idempotencyKey: `idem_01JZZZZZZZZZZZZZZZZZZZ${id}`,
    requestedAt: '2026-08-02T08:00:00.000Z',
  };
}
const list = (path = 'src', turnId = TURN_ID): ToolInvocation => call('list', { path }, turnId);

let sequence = 0;
function frameOf(type: string, payload: Record<string, unknown>): object {
  sequence += 1;
  return {
    schemaVersion: '2.0',
    eventId: `event-id-${String(sequence)}`,
    runId: RUN_ID,
    sequence,
    timestamp: '2026-08-02T10:00:00.000Z',
    type,
    visibility: 'user',
    sensitivity: 'workspace',
    epochs,
    payload,
  };
}
const toolRequested = (invocation: ToolInvocation): object =>
  frameOf('tool.requested', { invocation, invocationId: invocation.invocationId });
const streamTurn = (round: number): string =>
  `turn_01JZZZZZZZZZZZZZZZZZZZZ${String(round).padStart(3, '0')}`;
const heartbeat = { type: 'HEARTBEAT' };

function follow(p: Panel, service: RuntimeEventStreamService, signal: AbortSignal) {
  const onEvent = vi.fn();
  const outcome = service.follow(RUN_ID, p.service, { onEvent }, signal).then(
    () => undefined,
    (error: unknown) => error,
  );
  return { onEvent, outcome };
}

afterEach(closePanelMocks);

describe('A. the panel retries what is safe to repeat', () => {
  it('a 429 on run start starts exactly one run, then the run completes', async () => {
    const p = await panel();
    p.mock.plan.start.push({ status: 429 });
    sequence = 0;

    await expect(p.service.start(START)).resolves.toEqual({ runId: RUN_ID });

    const starts = p.mock.seen.filter((entry) => entry.route === 'start');
    expect(starts).toHaveLength(2);
    expect(new Set(starts.map((entry) => entry.key))).toEqual(new Set([START.idempotencyKey]));
    expect(p.sleeps).toHaveLength(1);

    const abort = new AbortController();
    const { outcome } = follow(p, p.stream(), abort.signal);
    await vi.waitFor(() => {
      expect(p.mock.streams).toHaveLength(1);
    });
    p.mock.push(0, toolRequested(list()));
    await vi.waitFor(() => {
      expect(p.mock.count('results')).toBe(1);
    });
    p.mock.push(0, frameOf('run.completed', {}));
    await expect(outcome).resolves.toBeUndefined();
    expect(p.executed).toHaveLength(1);
    expect(p.events.some((event) => event.type === 'run.created')).toBe(true);
  });

  it('a 503 on run start is not repeated, so no second start can conflict with the first', async () => {
    const p = await panel();
    p.mock.plan.start.push({ status: 503 });
    sequence = 0;

    await expect(p.service.start(START)).rejects.toMatchObject({ status: 503 });
    expect(p.mock.seen.filter((entry) => entry.route === 'start')).toHaveLength(1);
  });

  it('a 429 with Retry-After on the tool result is posted twice with one key, and succeeds', async () => {
    const p = await panel();
    await p.service.start(START);
    p.mock.plan.results.push({ status: 429, headers: { 'Retry-After': '2' } });

    const result = await p.service.dispatch(list(), keep);

    expect(result.status).toBe('succeeded');
    const posts = p.mock.seen.filter((entry) => entry.route === 'results');
    expect(posts).toHaveLength(2);
    expect(posts[0]?.key).toMatch(/:result$/u);
    expect(posts[1]?.key).toBe(posts[0]?.key);
    expect(p.sleeps).toEqual([2_000]);
  });

  it('a steer has no idempotency key and is never retried', async () => {
    const p = await panel();
    await p.service.start(START);
    p.mock.plan.steering.push({ status: 503 });

    const steered = p.backend.steerRuntime(
      { threadId: START.threadId, runId: RUN_ID, generation: 'generation-1', epochs },
      { text: 'actually, do something else' },
    );

    await expect(steered).rejects.toMatchObject({ status: 503 });
    expect(p.mock.count('steering')).toBe(1);
    expect(p.sleeps).toEqual([]);
  });

  it('a 401 on the tool result is an answer, not retried', async () => {
    const p = await panel();
    await p.service.start(START);
    p.mock.plan.results.push({ status: 401 });

    await expect(p.service.dispatch(list(), keep)).rejects.toThrow();

    expect(p.mock.count('results')).toBe(1);
    expect(p.sleeps).toEqual([]);
  });
});

describe('B. a run that only sends heartbeats is not left spinning', () => {
  const IDLE = 1_000;

  it('reattaches once from the cursor, then fails with RuntimeStreamIdleError', async () => {
    const p = await panel();
    await p.service.start(START);
    p.clock.now = 0;
    sequence = 0;
    const abort = new AbortController();
    const { onEvent, outcome } = follow(p, p.stream(IDLE), abort.signal);

    await vi.waitFor(() => {
      expect(p.mock.streams).toHaveLength(1);
    });
    p.mock.push(0, frameOf('run.started', {}), heartbeat);
    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledTimes(1);
    });
    p.clock.now = IDLE;
    p.mock.push(0, heartbeat);

    await vi.waitFor(() => {
      expect(p.mock.streams).toHaveLength(2);
    });
    const afters = p.mock.seen.filter((entry) => entry.route === 'stream').map((e) => e.after);
    expect(afters).toEqual([-1, 1]);
    p.clock.now = IDLE * 2;
    p.mock.push(1, heartbeat);

    const error = await outcome;
    expect(error).toBeInstanceOf(RuntimeStreamIdleError);
    expect(p.mock.streams).toHaveLength(2);
    expect(abort.signal.aborted).toBe(false);
  });

  it('never trips while real events arrive between heartbeats', async () => {
    const p = await panel();
    await p.service.start(START);
    sequence = 0;
    const { onEvent, outcome } = follow(p, p.stream(IDLE), new AbortController().signal);
    await vi.waitFor(() => {
      expect(p.mock.streams).toHaveLength(1);
    });

    for (let step = 1; step <= 5; step += 1) {
      p.clock.now += IDLE - 1;
      p.mock.push(0, heartbeat, frameOf('run.started', {}));
      await vi.waitFor(() => {
        expect(onEvent).toHaveBeenCalledTimes(step);
      });
    }
    p.mock.push(0, frameOf('run.completed', {}));

    await expect(outcome).resolves.toBeUndefined();
    expect(p.mock.streams).toHaveLength(1);
  });

  it('never trips while a long tool call is running', async () => {
    let finish: () => void = () => undefined;
    const p = await panel(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await p.service.start(START);
    sequence = 0;
    const { outcome } = follow(p, p.stream(IDLE), new AbortController().signal);
    await vi.waitFor(() => {
      expect(p.mock.streams).toHaveLength(1);
    });
    p.mock.push(0, toolRequested(list()), heartbeat);
    await vi.waitFor(() => {
      expect(p.executed).toHaveLength(1);
    });

    for (let beat = 0; beat < 5; beat += 1) {
      p.clock.now += IDLE * 3;
      p.mock.push(0, heartbeat);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(p.mock.streams).toHaveLength(1);

    finish();
    await vi.waitFor(() => {
      expect(p.mock.count('results')).toBe(1);
    });
    p.mock.push(0, frameOf('run.completed', {}));
    await expect(outcome).resolves.toBeUndefined();
    expect(p.mock.streams).toHaveLength(1);
  });
});

describe('C and D. the loop guard ends a stuck run and the panel is told', () => {
  it('refuses the 3rd identical call, fails the 8th with RUNTIME_RUN_STUCK, and tells the sink', async () => {
    const p = await panel();
    await p.service.start(START);

    const results = [];
    for (let index = 0; index < 7; index += 1) {
      results.push(await p.service.dispatch(list(), keep));
    }
    expect(p.executed).toHaveLength(2);
    expect(results[1]?.structured).toMatchObject({ files: 3 });
    expect(results[2]?.structured).toMatchObject({ repeatedCall: true, times: 3 });
    expect(p.events.some((event) => event.type === 'run.failed')).toBe(false);

    const eighth = p.service.dispatch(list(), keep);
    await expect(eighth).rejects.toBeInstanceOf(RuntimeStuckError);
    await expect(eighth).rejects.toMatchObject({ code: 'RUNTIME_RUN_STUCK' });

    // The stuck call's own result is submitted and published before the run fails.
    expect(p.mock.count('results')).toBe(8);
    const types = p.events.map((event) => event.type);
    expect(types.filter((type) => type === 'tool.started')).toHaveLength(8);
    expect(types.filter((type) => type === 'tool.completed')).toHaveLength(8);
    expect(types.indexOf('run.failed')).toBeGreaterThan(types.lastIndexOf('tool.completed'));
    expect(p.executed).toHaveLength(2);
    const failed = p.events.filter((event) => event.type === 'run.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.payload).toMatchObject({ reason: { code: 'RUNTIME_RUN_STUCK' } });
    expect(p.service.hasActiveRun()).toBe(false);
  });

  it('an intervening successful write resets the count', async () => {
    const p = await panel();
    await p.service.start(START);

    for (let index = 0; index < 7; index += 1) await p.service.dispatch(list(), keep);
    await p.service.dispatch(call('create', { path: 'x.ts' }), keep);
    const after = await p.service.dispatch(list(), keep);

    expect(after.structured).toMatchObject({ files: 3 });
    expect(p.executed).toHaveLength(4);
    expect(p.events.some((event) => event.type === 'run.failed')).toBe(false);
    expect(p.service.hasActiveRun()).toBe(true);
  });

  it('over the live stream, eight identical requests end the follow with the stuck error', async () => {
    const p = await panel();
    await p.service.start(START);
    sequence = 0;
    const { outcome } = follow(p, p.stream(), new AbortController().signal);
    await vi.waitFor(() => {
      expect(p.mock.streams).toHaveLength(1);
    });

    for (let round = 1; round <= 7; round += 1) {
      p.mock.push(0, toolRequested(list('src', streamTurn(round))));
      await vi.waitFor(() => {
        expect(p.mock.count('results')).toBe(round);
      });
    }
    p.mock.push(0, toolRequested(list('src', streamTurn(8))));

    const error = await outcome;
    expect(error).toBeInstanceOf(RuntimeStuckError);
    expect(p.executed).toHaveLength(2);
    expect(
      p.events.filter((event) => event.type === 'run.failed').map((event) => event.payload),
    ).toEqual([
      { reason: { code: 'RUNTIME_RUN_STUCK', message: expect.stringContaining('8 times') } },
    ]);
  });
});
