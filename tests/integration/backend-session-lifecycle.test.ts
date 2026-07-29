import { describe, expect, it, vi } from 'vitest';

import { BackendClient } from '../../src/backend/backend-client';
import { SessionVault, type SecretStoragePort } from '../../src/core/session-vault';

const BACKEND_URL = 'https://lifecycle.claw.example';
const initialTokens = {
  accessToken: 'expired-access',
  refreshToken: 'valid-refresh',
  expiresIn: 900,
  refreshExpiresIn: 2_592_000,
  tokenType: 'Bearer' as const,
};
const rotatedTokens = {
  ...initialTokens,
  accessToken: 'fresh-access',
  refreshToken: 'rotated-refresh',
};
const profile = {
  appearancePreference: 'SYSTEM',
  email: 'dev@example.com',
  id: 'user-1',
  languagePreference: 'en',
  mustChangePassword: false,
  permissions: [],
  role: 'USER',
  username: 'dev',
};

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

async function authenticatedClient(fetcher: typeof fetch) {
  const storage = new MemorySecretStorage();
  const vault = new SessionVault(storage);
  await vault.save(BACKEND_URL, initialTokens);
  return {
    client: new BackendClient({
      backendUrl: BACKEND_URL,
      fetcher,
      sessionVault: vault,
      timeoutMs: 1_000,
    }),
    storage,
    vault,
  };
}

describe('BackendClient session lifecycle', () => {
  it('never sends a replacement account token from a stale VS Code window', async () => {
    const storage = new MemorySecretStorage();
    const firstVault = new SessionVault(storage);
    const secondVault = new SessionVault(storage);
    await firstVault.save(BACKEND_URL, {
      ...initialTokens,
      accessToken: 'user-1-access',
    });
    const authorizations: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const authorization = new Headers(init?.headers).get('Authorization');
      if (authorization !== null) {
        authorizations.push(authorization);
      }
      return Response.json(profile);
    });
    const staleClient = new BackendClient({
      backendUrl: BACKEND_URL,
      fetcher,
      sessionVault: firstVault,
      timeoutMs: 1_000,
    });
    await staleClient.getProfile();

    await secondVault.clear(BACKEND_URL);
    await secondVault.save(BACKEND_URL, {
      ...rotatedTokens,
      accessToken: 'user-2-access',
    });

    await expect(staleClient.getProfile()).rejects.toThrow(
      'account changed in another VS Code window',
    );
    expect(authorizations).toEqual(['Bearer user-1-access']);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not erase a newer login when remote logout finishes late', async () => {
    let completeLogout: ((response: Response) => void) | undefined;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(input.toString()).pathname;
      if (path.endsWith('/auth/logout')) {
        return new Promise<Response>((resolve) => {
          completeLogout = resolve;
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const { client, vault } = await authenticatedClient(fetcher);

    const loggingOut = client.logout();
    await vi.waitFor(() => {
      expect(completeLogout).toBeTypeOf('function');
    });
    await vault.save(BACKEND_URL, rotatedTokens);
    completeLogout?.(new Response(null, { status: 204 }));
    await loggingOut;

    await expect(vault.load(BACKEND_URL)).resolves.toEqual(rotatedTokens);
  });

  it('never restores a session when an in-flight refresh finishes after logout', async () => {
    let completeRefresh: ((response: Response) => void) | undefined;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(input.toString()).pathname;
      if (path.endsWith('/auth/me')) {
        return new Response('expired', { status: 401 });
      }
      if (path.endsWith('/auth/refresh')) {
        return new Promise<Response>((resolve) => {
          completeRefresh = resolve;
        });
      }
      if (path.endsWith('/auth/logout')) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const { client, vault } = await authenticatedClient(fetcher);
    const profileRequest = client.getProfile();
    await vi.waitFor(() => {
      expect(completeRefresh).toBeTypeOf('function');
    });

    await client.logout();
    completeRefresh?.(Response.json({ tokens: rotatedTokens }));

    await expect(profileRequest).rejects.toBeDefined();
    await expect(vault.load(BACKEND_URL)).resolves.toBeNull();
  });

  it("never lets an old client's refresh restore tokens after a replacement client logs out", async () => {
    let completeRefresh: ((response: Response) => void) | undefined;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(input.toString()).pathname;
      if (path.endsWith('/auth/me')) {
        return new Response('expired', { status: 401 });
      }
      if (path.endsWith('/auth/refresh')) {
        return new Promise<Response>((resolve) => {
          completeRefresh = resolve;
        });
      }
      if (path.endsWith('/auth/logout')) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const { client: oldClient, storage, vault } = await authenticatedClient(fetcher);
    const replacementVault = new SessionVault(storage);
    const replacementClient = new BackendClient({
      backendUrl: BACKEND_URL,
      fetcher,
      sessionVault: replacementVault,
      timeoutMs: 1_000,
    });
    const profileRequest = oldClient.getProfile();
    await vi.waitFor(() => {
      expect(completeRefresh).toBeTypeOf('function');
    });

    await replacementClient.logout();
    completeRefresh?.(Response.json({ tokens: rotatedTokens }));

    await expect(profileRequest).rejects.toBeDefined();
    await expect(vault.load(BACKEND_URL)).resolves.toBeNull();
    await expect(replacementVault.load(BACKEND_URL)).resolves.toBeNull();
  });

  it('serializes refresh-token rotation across vault instances sharing SecretStorage', async () => {
    const storage = new MemorySecretStorage();
    const firstVault = new SessionVault(storage);
    const secondVault = new SessionVault(storage);
    await firstVault.save(BACKEND_URL, initialTokens);
    let completeRefresh: ((response: Response) => void) | undefined;
    let profileCalls = 0;
    let refreshCalls = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(input.toString()).pathname;
      if (path.endsWith('/auth/me')) {
        profileCalls += 1;
        return profileCalls <= 2
          ? new Response('expired', { status: 401 })
          : Response.json(profile);
      }
      if (path.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return new Promise<Response>((resolve) => {
          if (refreshCalls === 1) {
            completeRefresh = resolve;
          }
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const firstClient = new BackendClient({
      backendUrl: BACKEND_URL,
      fetcher,
      sessionVault: firstVault,
      timeoutMs: 1_000,
    });
    const secondClient = new BackendClient({
      backendUrl: BACKEND_URL,
      fetcher,
      sessionVault: secondVault,
      timeoutMs: 1_000,
    });

    const firstProfile = firstClient.getProfile();
    const secondProfile = secondClient.getProfile();
    await vi.waitFor(() => {
      expect(completeRefresh).toBeTypeOf('function');
    });

    expect(refreshCalls).toBe(1);
    completeRefresh?.(Response.json({ tokens: rotatedTokens }));
    await expect(Promise.all([firstProfile, secondProfile])).resolves.toHaveLength(2);
    expect(refreshCalls).toBe(1);
  });

  it('stops waiting for a shared refresh when the caller cancels', async () => {
    let startRefresh: (() => void) | undefined;
    const refreshStarted = new Promise<void>((resolve) => {
      startRefresh = resolve;
    });
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(input.toString()).pathname;
      if (path.endsWith('/chat-messages/parallel')) {
        return new Response('expired', { status: 401 });
      }
      if (path.endsWith('/auth/refresh')) {
        startRefresh?.();
        return new Promise<Response>(() => undefined);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const { client } = await authenticatedClient(fetcher);
    const controller = new AbortController();
    const cancellation = new Error('Caller cancelled during refresh.');
    const request = client.compare(
      {
        content: 'Compare',
        models: [{ provider: 'OPENAI', model: 'gpt-5' }],
      },
      controller.signal,
    );
    await refreshStarted;

    controller.abort(cancellation);

    await expect(request).rejects.toBe(cancellation);
  });
});
