import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import { BackendClient, BackendSessionExpiredError } from '../../src/backend/backend-client';
import { SessionVault, type SecretStoragePort } from '../../src/core/session-vault';

const BACKEND_URL = 'https://silent.claw.example';
const ROTATED_REFRESH_REJECTION = JSON.stringify({
  code: 'INVALID_REFRESH_TOKEN',
  message: 'Invalid or expired refresh token',
  statusCode: 401,
});

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

const message = {
  content: 'Hello',
  id: 'message-1',
  role: 'ASSISTANT',
  threadId: 'thread-1',
};

class MemorySecretStorage implements SecretStoragePort {
  readonly values = new Map<string, string>();

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

function accessTokenExpiringIn(seconds: number, subject = 'user-1'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8').toString(
    'base64url',
  );
  const claims = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1_000) + seconds, sub: subject }),
    'utf8',
  ).toString('base64url');
  return `${header}.${claims}.not-a-real-signature`;
}

function tokenPair(accessToken: string, refreshToken: string) {
  return {
    accessToken,
    expiresIn: 900,
    refreshExpiresIn: 2_592_000,
    refreshToken,
    tokenType: 'Bearer' as const,
  };
}

async function clientWith(
  tokens: ReturnType<typeof tokenPair>,
  fetcher: typeof fetch,
): Promise<{ client: BackendClient; vault: SessionVault }> {
  const vault = new SessionVault(new MemorySecretStorage());
  await vault.save(BACKEND_URL, tokens);
  return {
    client: new BackendClient({
      backendUrl: BACKEND_URL,
      fetcher,
      sessionVault: vault,
      timeoutMs: 1_000,
    }),
    vault,
  };
}

function pathOf(input: Parameters<typeof fetch>[0]): string {
  return new URL(input.toString()).pathname;
}

function authorizationOf(init: Parameters<typeof fetch>[1]): string | null {
  return new Headers(init?.headers).get('Authorization');
}

describe('BackendClient silent refresh', () => {
  it('rotates before expiry so no authenticated request ever spends a 401', async () => {
    const rotated = accessTokenExpiringIn(900);
    const seen: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const path = pathOf(input);
      seen.push(path);
      if (path.endsWith('/auth/refresh')) {
        return Response.json({ tokens: tokenPair(rotated, 'refresh-2') });
      }
      if (path.endsWith('/auth/me')) {
        expect(authorizationOf(init)).toBe(`Bearer ${rotated}`);
        return Response.json(profile);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const { client, vault } = await clientWith(
      tokenPair(accessTokenExpiringIn(30), 'refresh-1'),
      fetcher,
    );

    await expect(client.getProfile()).resolves.toMatchObject({ id: 'user-1' });

    expect(seen).toEqual(['/api/v1/auth/refresh', '/api/v1/auth/me']);
    await expect(vault.load(BACKEND_URL)).resolves.toMatchObject({ refreshToken: 'refresh-2' });
  });

  it('leaves a healthy access token alone', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      expect(pathOf(input)).toBe('/api/v1/auth/me');
      return Response.json(profile);
    });
    const { client } = await clientWith(
      tokenPair(accessTokenExpiringIn(900), 'refresh-1'),
      fetcher,
    );

    await expect(client.getProfile()).resolves.toMatchObject({ id: 'user-1' });

    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rotates before opening a live event stream so a run never loses its transport', async () => {
    const rotated = accessTokenExpiringIn(900);
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const path = pathOf(input);
      if (path.endsWith('/auth/refresh')) {
        return Response.json({ tokens: tokenPair(rotated, 'refresh-2') });
      }
      expect(path).toBe('/api/v1/chat-messages/stream/thread-1');
      expect(authorizationOf(init)).toBe(`Bearer ${rotated}`);
      return new Response('data: {"type":"DONE"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
    const { client } = await clientWith(tokenPair(accessTokenExpiringIn(10), 'refresh-1'), fetcher);

    await expect(client.openStream('thread-1')).resolves.toBeInstanceOf(Response);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  // A refresh in the middle of an agent run has to be invisible: the run keeps
  // sending, the panel keeps its composer, and nothing surfaces a session error.
  it('carries an in-flight run across an access-token expiry without interrupting it', async () => {
    let refreshes = 0;
    const rotated = accessTokenExpiringIn(900);
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const path = pathOf(input);
      if (path.endsWith('/auth/refresh')) {
        refreshes += 1;
        return Response.json({ tokens: tokenPair(rotated, `refresh-${String(refreshes + 1)}`) });
      }
      if (authorizationOf(init) !== `Bearer ${rotated}`) {
        return new Response('expired access', { status: 401 });
      }
      if (path.endsWith('/chat-messages')) {
        return Response.json(message);
      }
      return new Response('data: {"type":"DONE"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
    const { client } = await clientWith(tokenPair(accessTokenExpiringIn(5), 'refresh-1'), fetcher);

    await expect(
      client.sendMessage({ content: 'Build it', routingMode: 'AUTO', threadId: 'thread-1' }),
    ).resolves.toMatchObject({ id: 'message-1' });
    await expect(client.openStream('thread-1')).resolves.toBeInstanceOf(Response);
    await expect(
      client.sendMessage({ content: 'Keep going', routingMode: 'AUTO', threadId: 'thread-1' }),
    ).resolves.toMatchObject({ id: 'message-1' });

    expect(refreshes).toBe(1);
  });

  it('shares one rotation between concurrent rejected requests', async () => {
    let refreshes = 0;
    let releaseRefresh: ((response: Response) => void) | undefined;
    const rotated = accessTokenExpiringIn(900);
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const path = pathOf(input);
      if (path.endsWith('/auth/refresh')) {
        refreshes += 1;
        return new Promise<Response>((resolve) => {
          releaseRefresh = resolve;
        });
      }
      return authorizationOf(init) === `Bearer ${rotated}`
        ? Response.json(profile)
        : new Response('expired access', { status: 401 });
    });
    // An opaque access token carries no readable expiry, so nothing rotates up
    // front and both requests genuinely race on the 401 path.
    const { client } = await clientWith(tokenPair('opaque-access', 'refresh-1'), fetcher);

    const requests = [client.getProfile(), client.getProfile(), client.getProfile()];
    await vi.waitFor(() => {
      expect(releaseRefresh).toBeTypeOf('function');
    });
    releaseRefresh?.(Response.json({ tokens: tokenPair(rotated, 'refresh-2') }));

    await expect(Promise.all(requests)).resolves.toHaveLength(3);
    expect(refreshes).toBe(1);
  });

  // The backend consumes the presented refresh token as it answers and revokes
  // the whole family if it is ever seen again, so the extension must present
  // each rotated token exactly once.
  it('never replays a refresh token the backend has already consumed', async () => {
    const consumed = new Set<string>();
    const presented: string[] = [];
    let issued = 1;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const path = pathOf(input);
      if (path.endsWith('/auth/refresh')) {
        const body: unknown = JSON.parse(String(init?.body ?? '{}'));
        const token = String((body as { refreshToken?: unknown }).refreshToken);
        presented.push(token);
        if (consumed.has(token)) {
          return new Response(ROTATED_REFRESH_REJECTION, { status: 401 });
        }
        consumed.add(token);
        issued += 1;
        return Response.json({
          tokens: tokenPair(accessTokenExpiringIn(30), `refresh-${String(issued)}`),
        });
      }
      return Response.json(profile);
    });
    const { client, vault } = await clientWith(
      tokenPair(accessTokenExpiringIn(30), 'refresh-1'),
      fetcher,
    );

    await client.getProfile();
    await client.getProfile();
    await client.getProfile();

    expect(presented).toEqual(['refresh-1', 'refresh-2', 'refresh-3']);
    expect(new Set(presented).size).toBe(presented.length);
    await expect(vault.load(BACKEND_URL)).resolves.toMatchObject({ refreshToken: 'refresh-4' });
  });

  it('falls back to sign-in once when the refresh token is genuinely rejected', async () => {
    let refreshes = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (pathOf(input).endsWith('/auth/refresh')) {
        refreshes += 1;
        return new Response(ROTATED_REFRESH_REJECTION, { status: 401 });
      }
      return new Response('expired access', { status: 401 });
    });
    const { client, vault } = await clientWith(
      tokenPair('opaque-access', 'revoked-refresh'),
      fetcher,
    );

    await expect(client.getProfile()).rejects.toBeInstanceOf(BackendSessionExpiredError);
    await expect(client.getProfile()).rejects.toBeDefined();
    await expect(client.getUsage()).rejects.toBeDefined();

    expect(refreshes).toBe(1);
    await expect(vault.load(BACKEND_URL)).resolves.toBeNull();
  });

  it('stops rotating after a rejection instead of looping on the proactive path', async () => {
    let refreshes = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (pathOf(input).endsWith('/auth/refresh')) {
        refreshes += 1;
        return new Response(ROTATED_REFRESH_REJECTION, { status: 401 });
      }
      return Response.json(profile);
    });
    const { client } = await clientWith(
      tokenPair(accessTokenExpiringIn(5), 'revoked-refresh'),
      fetcher,
    );

    await expect(client.getProfile()).rejects.toBeInstanceOf(BackendSessionExpiredError);
    await expect(client.getProfile()).rejects.toBeDefined();

    expect(refreshes).toBe(1);
  });

  it('sends the refresh token only in the refresh request body and never in a failure', async () => {
    const secret = 'refresh-token-that-must-not-leak';
    const requests: { authorization: string | null; body: string; url: string }[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      requests.push({
        authorization: authorizationOf(init),
        body: String(init?.body ?? ''),
        url: input.toString(),
      });
      if (pathOf(input).endsWith('/auth/refresh')) {
        return new Response(`${ROTATED_REFRESH_REJECTION} presented ${secret}`, { status: 401 });
      }
      return new Response('expired access', { status: 401 });
    });
    const { client } = await clientWith(tokenPair('opaque-access', secret), fetcher);

    const failure = await client.getProfile().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BackendSessionExpiredError);
    expect(String(failure)).not.toContain(secret);
    expect(JSON.stringify((failure as Error).stack ?? '')).not.toContain(secret);
    for (const request of requests) {
      expect(request.url).not.toContain(secret);
      expect(request.authorization ?? '').not.toContain(secret);
      if (!request.url.includes('/auth/refresh')) {
        expect(request.body).not.toContain(secret);
      }
    }
    expect(requests.filter((request) => request.body.includes(secret))).toHaveLength(1);
  });
});
