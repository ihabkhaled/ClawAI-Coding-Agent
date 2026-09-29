import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackendClient } from '../../src/backend/backend-client';
import { ZeroRetentionRefusedError } from '../../src/backend/zero-retention-guard';
import { SessionVault, type SecretStoragePort } from '../../src/core/session-vault';
import { zeroRetentionPosture } from '../../src/core/zero-retention-posture';
import { ZERO_RETENTION_HEADER, ZERO_RETENTION_OFF } from '../../src/core/zero-retention.constants';

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

const BACKEND = 'https://zdr.claw.example';

async function client(fetcher: typeof fetch): Promise<BackendClient> {
  const vault = new SessionVault(new MemorySecretStorage());
  await vault.save(BACKEND, {
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresIn: 900,
    refreshExpiresIn: 2_592_000,
    tokenType: 'Bearer',
  });
  return new BackendClient({ backendUrl: BACKEND, fetcher, sessionVault: vault, timeoutMs: 1_000 });
}

function headersOf(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): Record<string, string> {
  const init = fetcher.mock.calls[0]?.[1];
  const headers = init?.headers;
  return headers !== undefined && !(headers instanceof Headers) && !Array.isArray(headers)
    ? headers
    : {};
}

describe('BackendClient under zero data retention', () => {
  afterEach(() => {
    zeroRetentionPosture.set(ZERO_RETENTION_OFF);
  });

  it('asks the backend not to retain content on every request', async () => {
    zeroRetentionPosture.set({ active: true, source: 'setting' });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'message-1' }));
    const backend = await client(fetcher);

    // Only the outgoing headers matter here, not whether the stub parses as a message.
    await backend
      .sendMessage({ threadId: 't-1', content: 'hi', routingMode: 'AUTO' })
      .catch(() => undefined);

    expect(headersOf(fetcher)[ZERO_RETENTION_HEADER]).toBe('1');
  });

  it('sends no retention header when retention is normal', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'message-1' }));
    const backend = await client(fetcher);

    // Only the outgoing headers matter here, not whether the stub parses as a message.
    await backend
      .sendMessage({ threadId: 't-1', content: 'hi', routingMode: 'AUTO' })
      .catch(() => undefined);

    expect(headersOf(fetcher)).not.toHaveProperty(ZERO_RETENTION_HEADER);
  });

  it('refuses an upload without sending the bytes', async () => {
    zeroRetentionPosture.set({ active: true, source: 'organization' });
    const fetcher = vi.fn<typeof fetch>();
    const backend = await client(fetcher);

    await expect(
      backend.uploadFile({
        clientId: '83e65fe0-188f-4103-a644-6aa3ea327a98',
        content: 'Y2xhdw==',
        filename: 'screen.png',
        mimeType: 'image/png',
        sizeBytes: 4,
      }),
    ).rejects.toBeInstanceOf(ZeroRetentionRefusedError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
