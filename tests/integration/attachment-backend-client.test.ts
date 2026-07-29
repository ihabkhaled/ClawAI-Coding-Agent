import { describe, expect, it, vi } from 'vitest';

import { BackendClient } from '../../src/backend/backend-client';
import { SessionVault, type SecretStoragePort } from '../../src/core/session-vault';

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

describe('BackendClient attachments', () => {
  it('uploads a bounded attachment through the versioned files endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: 'file-1',
        filename: 'screen.png',
        mimeType: 'image/png',
        sizeBytes: 4,
      }),
    );
    const vault = new SessionVault(new MemorySecretStorage());
    await vault.save('https://attachments.claw.example', {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 900,
      refreshExpiresIn: 2_592_000,
      tokenType: 'Bearer',
    });
    const client = new BackendClient({
      backendUrl: 'https://attachments.claw.example',
      fetcher,
      sessionVault: vault,
      timeoutMs: 1_000,
    });

    await expect(
      client.uploadFile({
        clientId: '83e65fe0-188f-4103-a644-6aa3ea327a98',
        content: 'Y2xhdw==',
        filename: 'screen.png',
        mimeType: 'image/png',
        sizeBytes: 4,
      }),
    ).resolves.toMatchObject({ id: 'file-1' });

    expect(fetcher.mock.calls[0]?.[0].toString()).toBe(
      'https://attachments.claw.example/api/v1/files/upload',
    );
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body?.toString() ?? '{}')).toEqual({
      content: 'Y2xhdw==',
      filename: 'screen.png',
      mimeType: 'image/png',
      sizeBytes: 4,
    });
  });

  it('deletes a request-owned upload through the authenticated file endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: 'file / 1',
        filename: 'screen.png',
        mimeType: 'image/png',
        sizeBytes: 4,
      }),
    );
    const vault = new SessionVault(new MemorySecretStorage());
    await vault.save('https://attachments.claw.example', {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 900,
      refreshExpiresIn: 2_592_000,
      tokenType: 'Bearer',
    });
    const client = new BackendClient({
      backendUrl: 'https://attachments.claw.example',
      fetcher,
      sessionVault: vault,
      timeoutMs: 1_000,
    });

    await expect(client.deleteFile('file / 1')).resolves.toBeUndefined();

    expect(fetcher.mock.calls[0]?.[0].toString()).toBe(
      'https://attachments.claw.example/api/v1/files/file%20%2F%201',
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' });
  });
});
