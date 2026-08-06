import { describe, expect, it, vi } from 'vitest';

import { BackendClient } from '../../src/backend/backend-client';
import { SessionVault, type SecretStoragePort } from '../../src/core/session-vault';

const backendUrl = 'https://client.claw.example';

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

async function client(fetcher: typeof fetch): Promise<BackendClient> {
  const vault = new SessionVault(new MemorySecretStorage());
  await vault.save(backendUrl, {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresIn: 900,
    refreshExpiresIn: 2_592_000,
    tokenType: 'Bearer',
  });
  return new BackendClient({ backendUrl, fetcher, sessionVault: vault, timeoutMs: 1_000 });
}

describe('BackendClient runtime protocol', () => {
  it('sends an authenticated bodyless GET and accepts future additive versions', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        Response.json({
          versions: ['3.0', '2.0', '1.0'],
          preferred: '3.0',
          transports: ['sse'],
          features: {
            capabilityManifest: true,
            orderedRunEvents: true,
            toolExecution: false,
          },
          limits: { maxEventBytes: 1_048_576, maxActiveRuns: 8 },
        }),
      ),
    );
    const backend = await client(fetcher);

    await expect(backend.getRuntimeProtocol()).resolves.toMatchObject({ preferred: '3.0' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0].toString()).toBe(
      'https://client.claw.example/api/v1/agent/runtime/protocol',
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' });
    expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty('body');
  });

  it('rejects malformed and duplicate descriptor versions', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        Response.json({
          versions: ['2.0', '2.0'],
          preferred: '2.0',
          transports: ['sse'],
          features: {},
          limits: {},
        }),
      ),
    );

    await expect((await client(fetcher)).getRuntimeProtocol()).rejects.toThrow();
  });
});

/**
 * Posting a tool result hands the run back to the platform, which calls the
 * model and only then answers. The request is therefore open for as long as the
 * turn takes, and the generic one-minute request budget aborted it from this
 * side while the backend was working perfectly well — "ClawAI request timed
 * out." in the panel, and the run lost. Seen twice in the final sweep, at 70 s
 * and 110 s.
 */
describe('BackendClient runtime command timeouts', () => {
  const binding = {
    threadId: 'thread-id-0001',
    runId: 'run-id-0001',
    generation: 'generation-id-0001',
    epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
  };
  const result = {
    schemaVersion: '2.0' as const,
    invocationId: 'invocation-id-0001',
    runId: 'run-id-0001',
    turnId: 'turn-id-0001',
    status: 'succeeded' as const,
    startedAt: '2026-08-06T19:00:00.000Z',
    completedAt: '2026-08-06T19:00:01.000Z',
    receipt: {
      invocationId: 'invocation-id-0001',
      receiptId: 'receipt-id-0001',
      toolName: 'workspace.files',
      toolVersion: '2.0.0',
      operation: 'read',
      targetId: 'target:workspace',
      decision: { outcome: 'allow' as const, code: 'POLICY_ALLOWED', risk: 'R0' as const },
      issuedAt: '2026-08-06T19:00:01.000Z',
    },
    continuation: { action: 'continue' as const, nextTurnId: 'turn-id-0002' },
  };

  function slowFetcher(bodyFor: (url: string) => unknown) {
    return vi.fn<typeof fetch>(async (url, init) => {
      await new Promise((resolve) => setTimeout(resolve, 1_400));
      init?.signal?.throwIfAborted();
      return new Response(JSON.stringify(bodyFor(String(url))), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
  }

  it('waits out a turn that takes longer than the generic request budget', async () => {
    const fetcher = slowFetcher(() => ({
      runId: binding.runId,
      sequence: 1,
      eventId: 'event-id-0001',
      replayed: false,
    }));
    const backend = await client(fetcher);

    await expect(
      backend.submitRuntimeResult(binding, 'idempotency-key-0001', result as never),
    ).resolves.toMatchObject({ runId: binding.runId, replayed: false });
  });

  it('still holds an ordinary request to the generic budget', async () => {
    const fetcher = slowFetcher(() => ({}));
    const backend = await client(fetcher);

    await expect(backend.getRuntimeProtocol()).rejects.toThrow();
  });
});
