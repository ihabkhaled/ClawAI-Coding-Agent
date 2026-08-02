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
