import { describe, expect, it } from 'vitest';

import { BackendClient } from '../../src/backend/backend-client';
import { SessionVault, type SecretStoragePort } from '../../src/core/session-vault';

import type { RuntimeCommandBinding } from '../../src/backend/backend-client.types';
import type { ToolResult } from '../../src/core/runtime/runtime-tool-contracts';

const URL_BASE = 'https://retry.claw.example';

class MemorySecrets implements SecretStoragePort {
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

function jwt(): string {
  const part = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  const exp = Math.floor(Date.now() / 1_000) + 3_600;
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ exp, sub: 'u' })}.sig`;
}

const binding = {
  threadId: 't1',
  runId: 'r1',
  generation: 'g1',
  epochs: {},
} as unknown as RuntimeCommandBinding;
const toolResult = { receipt: { receiptId: 'rc1' } } as unknown as ToolResult;
const protocol = {
  versions: ['2.0'],
  preferred: '2.0',
  transports: ['sse'],
  features: { capabilityManifest: true, orderedRunEvents: true, toolExecution: true },
  limits: { maxEventBytes: 1_048_576, maxActiveRuns: 4 },
};
const ack = { runId: 'r1', sequence: 1, eventId: 'e1', replayed: false };

interface Rig {
  readonly client: BackendClient;
  readonly waits: number[];
  readonly calls: () => number;
}

async function rig(
  responses: readonly (() => Response | Error)[],
  keys: unknown[] = [],
): Promise<Rig> {
  const vault = new SessionVault(new MemorySecrets());
  await vault.save(URL_BASE, {
    accessToken: jwt(),
    expiresIn: 3_600,
    refreshExpiresIn: 2_592_000,
    refreshToken: 'refresh',
    tokenType: 'Bearer',
  });
  const waits: number[] = [];
  let calls = 0;
  const fetcher: typeof fetch = (_input, init) => {
    keys.push(
      (JSON.parse(String(init?.body ?? '{}')) as { idempotencyKey?: unknown }).idempotencyKey,
    );
    const next = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    const outcome = next?.() ?? new Error('no scripted response');
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  };
  const client = new BackendClient({
    backendUrl: URL_BASE,
    fetcher,
    sessionVault: vault,
    timeoutMs: 5_000,
    retry: {
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      random: () => 0.5,
    },
  });
  return { client, waits, calls: () => calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers });
const reset = (): Error =>
  new TypeError('fetch failed', {
    cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
  });

describe('BackendClient retries', () => {
  it('retries a GET 429 and honours Retry-After', async () => {
    const r = await rig([
      () => json(429, { message: 'slow' }, { 'retry-after': '3' }),
      () => json(200, protocol),
    ]);
    await expect(r.client.getRuntimeProtocol()).resolves.toMatchObject({ preferred: '2.0' });
    expect(r.waits).toEqual([3_000]);
  });

  it('retries a GET after a network reset', async () => {
    const r = await rig([reset, () => json(200, protocol)]);
    await expect(r.client.getRuntimeProtocol()).resolves.toMatchObject({ preferred: '2.0' });
    expect(r.calls()).toBe(2);
  });

  it('retries a keyed tool-result post through 503s', async () => {
    const r = await rig([() => json(503, {}), () => json(503, {}), () => json(200, ack)]);
    await expect(
      r.client.submitRuntimeResult(binding, 'rc1:result', toolResult),
    ).resolves.toMatchObject({ runId: 'r1' });
    expect(r.calls()).toBe(3);
  });

  describe('run start', () => {
    const started = { runId: 'r1', generation: 'g1', messageId: 'm', sequence: 0, replayed: false };
    const request = { idempotencyKey: 'k1' } as unknown as Parameters<
      BackendClient['startRuntime']
    >[0];
    const refused = (): Error =>
      new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      });

    it('retries a 429 with the same key', async () => {
      const keys: unknown[] = [];
      const r = await rig([() => json(429, {}), () => json(200, started)], keys);
      await expect(r.client.startRuntime(request)).resolves.toMatchObject({ runId: 'r1' });
      expect(r.calls()).toBe(2);
      expect(keys).toEqual(['k1', 'k1']);
    });

    it('retries a refused connection', async () => {
      const r = await rig([refused, () => json(200, started)]);
      await expect(r.client.startRuntime(request)).resolves.toMatchObject({ runId: 'r1' });
      expect(r.calls()).toBe(2);
    });

    it('does not retry a 503, which may have admitted the run', async () => {
      const r = await rig([() => json(503, {}), () => json(200, started)]);
      await expect(r.client.startRuntime(request)).rejects.toMatchObject({ status: 503 });
      expect(r.calls()).toBe(1);
    });

    it('does not retry a reset after connect', async () => {
      const r = await rig([reset, () => json(200, started)]);
      await expect(r.client.startRuntime(request)).rejects.toBeInstanceOf(Error);
      expect(r.calls()).toBe(1);
    });
  });

  it('never retries steer or cancel', async () => {
    const steer = await rig([() => json(503, {}), () => json(200, ack)]);
    await expect(steer.client.steerRuntime(binding, { text: 'x' })).rejects.toMatchObject({
      status: 503,
    });
    expect(steer.calls()).toBe(1);
    const cancel = await rig([() => json(503, {}), () => json(200, ack)]);
    await expect(cancel.client.cancelRuntime(binding, 'cancel:r1')).rejects.toMatchObject({
      status: 503,
    });
    expect(cancel.calls()).toBe(1);
  });

  it('does not retry a command post that has no idempotency key', async () => {
    const r = await rig([() => json(503, {}), () => json(200, protocol)]);
    const request = {} as unknown as Parameters<BackendClient['startRuntime']>[0];
    await expect(r.client.startRuntime(request)).rejects.toMatchObject({ status: 503 });
    expect(r.calls()).toBe(1);
  });

  it('does not retry a 403 on a read', async () => {
    const r = await rig([() => json(403, { message: 'no' }), () => json(200, protocol)]);
    await expect(r.client.getRuntimeProtocol()).rejects.toMatchObject({ status: 403 });
    expect(r.calls()).toBe(1);
  });

  it('rethrows the last error when a read keeps failing', async () => {
    const r = await rig([() => json(503, {})]);
    await expect(r.client.getRuntimeProtocol()).rejects.toMatchObject({ status: 503 });
    expect(r.calls()).toBe(3);
  });
});
