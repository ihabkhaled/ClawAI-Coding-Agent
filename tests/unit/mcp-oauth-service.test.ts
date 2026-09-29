import { describe, expect, it, vi } from 'vitest';

import {
  authorizationMetadataUrl,
  buildAuthorizationUrl,
  isTokenFresh,
  parseTokenResponse,
  resolveAuthorizationEndpoints,
  tokenSecretKey,
} from '../../src/core/mcp/mcp-oauth';
import { McpOAuthService } from '../../src/services/mcp-oauth-service';

import type { McpHttpServerConfig } from '../../src/core/mcp/mcp.types';
import type { McpOAuthDependencies } from '../../src/services/mcp-oauth-service.types';

const server: McpHttpServerConfig = {
  name: 'remote',
  origin: 'user',
  transport: 'http',
  url: 'https://mcp.example.test/v1/mcp',
  headers: {},
  oauth: { clientId: 'client-1', scopes: ['read', 'write'] },
};

const NOW = 1_000_000;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function harness(overrides: Partial<McpOAuthDependencies> = {}) {
  const store = new Map<string, string>();
  const callback = {
    callbackUri: 'http://127.0.0.1:5555/auth/callback',
    waitForCallback: vi.fn(() => Promise.resolve('the-code')),
    confirmAuthorization: vi.fn(),
    rejectAuthorization: vi.fn(),
    dispose: vi.fn(),
  };
  const opened: string[] = [];
  const fetch = vi.fn((input: string, init: RequestInit) => {
    if (input.endsWith('/.well-known/oauth-authorization-server')) {
      return Promise.resolve(
        jsonResponse({
          authorization_endpoint: 'https://auth.example.test/authorize',
          token_endpoint: 'https://auth.example.test/token',
        }),
      );
    }
    const body = new URLSearchParams(String(init.body));
    if (body.get('grant_type') === 'refresh_token') {
      return Promise.resolve(jsonResponse({ access_token: 'refreshed', expires_in: 3600 }));
    }
    return Promise.resolve(
      jsonResponse({
        access_token: 'granted',
        refresh_token: 'r1',
        token_type: 'Bearer',
        expires_in: 60,
      }),
    );
  });
  const deps: McpOAuthDependencies = {
    secrets: {
      get: (key) => Promise.resolve(store.get(key)),
      store: (key, value) => {
        store.set(key, value);
        return Promise.resolve();
      },
      delete: (key) => {
        store.delete(key);
        return Promise.resolve();
      },
    },
    callbacks: { open: vi.fn(() => Promise.resolve(callback)) },
    openBrowser: (url) => {
      opened.push(url);
      return Promise.resolve(true);
    },
    fetch,
    now: () => NOW,
    ...overrides,
  };
  return { service: new McpOAuthService(deps), store, callback, opened, fetch };
}

describe('MCP OAuth pure helpers', () => {
  it('builds a PKCE authorization URL with the resource indicator and scopes', () => {
    const url = new URL(
      buildAuthorizationUrl({
        endpoint: 'https://auth.test/authorize?x=1',
        server,
        oauth: { clientId: 'c', scopes: ['a', 'b'] },
        redirectUri: 'http://127.0.0.1:1/auth/callback',
        codeChallenge: 'chal',
        state: 'st',
      }),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      x: '1',
      response_type: 'code',
      client_id: 'c',
      redirect_uri: 'http://127.0.0.1:1/auth/callback',
      code_challenge: 'chal',
      code_challenge_method: 'S256',
      state: 'st',
      resource: server.url,
      scope: 'a b',
    });
  });

  it('resolves endpoints from configuration first, discovery second', () => {
    expect(authorizationMetadataUrl(server.url)).toBe(
      'https://mcp.example.test/.well-known/oauth-authorization-server',
    );
    expect(
      resolveAuthorizationEndpoints(
        {
          clientId: 'c',
          scopes: [],
          authorizationEndpoint: 'https://a.test/x',
          tokenEndpoint: 'https://a.test/t',
        },
        undefined,
      ),
    ).toEqual({ authorizationEndpoint: 'https://a.test/x', tokenEndpoint: 'https://a.test/t' });
    expect(() =>
      resolveAuthorizationEndpoints(
        { clientId: 'c', scopes: [] },
        { authorization_endpoint: 'http://evil.test/a', token_endpoint: 'https://a.test/t' },
      ),
    ).toThrow();
  });

  it('parses token responses, keeps a prior refresh token, and refuses non-bearer', () => {
    expect(parseTokenResponse({ access_token: 'a', expires_in: 10 }, 0, 'old')).toEqual({
      accessToken: 'a',
      refreshToken: 'old',
      expiresAt: 10_000,
    });
    expect(parseTokenResponse({ access_token: 'a' }, 0)).toEqual({ accessToken: 'a' });
    expect(() => parseTokenResponse({ access_token: 'a', token_type: 'mac' }, 0)).toThrow('bearer');
    expect(isTokenFresh({ accessToken: 'a' }, NOW)).toBe(true);
    expect(isTokenFresh({ accessToken: 'a', expiresAt: NOW + 30_000 }, NOW)).toBe(false);
    expect(tokenSecretKey(server)).toMatch(/^clawai\.mcp\.oauth\.remote\.[a-f0-9]{16}$/u);
    expect(tokenSecretKey({ ...server, url: 'https://other.test/mcp' })).not.toBe(
      tokenSecretKey(server),
    );
  });
});

describe('McpOAuthService', () => {
  it('has no token before authorization, then runs the loopback PKCE flow and stores tokens', async () => {
    const { service, store, callback, opened, fetch } = harness();
    const provider = service.tokenProvider(server);
    expect(await provider.current()).toBeUndefined();
    expect(await provider.renew()).toBe('granted');
    const authorize = new URL(opened[0] ?? '');
    expect(authorize.origin + authorize.pathname).toBe('https://auth.example.test/authorize');
    expect(authorize.searchParams.get('redirect_uri')).toBe(callback.callbackUri);
    const exchange = fetch.mock.calls.find(([url]) => url === 'https://auth.example.test/token');
    const body = new URLSearchParams(String(exchange?.[1].body));
    expect(body.get('code')).toBe('the-code');
    expect(body.get('code_verifier')?.length).toBeGreaterThan(40);
    expect(callback.confirmAuthorization).toHaveBeenCalled();
    expect(callback.dispose).toHaveBeenCalled();
    expect(JSON.parse(store.get(tokenSecretKey(server)) ?? '{}')).toMatchObject({
      accessToken: 'granted',
      refreshToken: 'r1',
    });
  });

  it('returns a fresh stored token, and refreshes a stale one', async () => {
    const { service, store } = harness();
    store.set(
      tokenSecretKey(server),
      JSON.stringify({ accessToken: 'kept', expiresAt: NOW + 3_600_000 }),
    );
    expect(await service.tokenProvider(server).current()).toBe('kept');
    store.set(
      tokenSecretKey(server),
      JSON.stringify({ accessToken: 'old', refreshToken: 'r', expiresAt: NOW }),
    );
    expect(await service.tokenProvider(server).current()).toBe('refreshed');
    expect(JSON.parse(store.get(tokenSecretKey(server)) ?? '{}')).toMatchObject({
      refreshToken: 'r',
    });
    store.set(tokenSecretKey(server), 'not json');
    expect(await service.tokenProvider(server).current()).toBeUndefined();
  });

  it('falls back to authorization when a refresh is refused, dropping the stale set', async () => {
    const fetch = vi.fn((input: string) =>
      Promise.resolve(
        input.endsWith('oauth-authorization-server')
          ? jsonResponse({
              authorization_endpoint: 'https://a.test/a',
              token_endpoint: 'https://a.test/t',
            })
          : jsonResponse({ error: 'invalid_grant' }, 400),
      ),
    );
    const { service, store, callback } = harness({ fetch });
    store.set(
      tokenSecretKey(server),
      JSON.stringify({ accessToken: 'old', refreshToken: 'r', expiresAt: NOW }),
    );
    await expect(service.tokenProvider(server).renew()).rejects.toThrow('HTTP 400');
    expect(store.has(tokenSecretKey(server))).toBe(false);
    expect(callback.rejectAuthorization).toHaveBeenCalled();
  });

  it('refuses to renew a server without OAuth, and fails when the browser cannot open', async () => {
    const { service } = harness({ openBrowser: () => Promise.resolve(false) });
    const plain: McpHttpServerConfig = {
      name: server.name,
      origin: server.origin,
      transport: 'http',
      url: server.url,
      headers: {},
    };
    expect(await service.tokenProvider(plain).renew()).toBeUndefined();
    await expect(service.tokenProvider(server).renew()).rejects.toThrow('could not open');
  });

  it('honours cancellation while waiting for the browser, and forgets on request', async () => {
    const pending = harness();
    pending.callback.waitForCallback.mockReturnValue(new Promise<string>(() => undefined));
    const controller = new AbortController();
    const renewing = pending.service.tokenProvider(server).renew(controller.signal);
    await vi.waitFor(() => {
      expect(pending.opened).toHaveLength(1);
    });
    controller.abort();
    await expect(renewing).rejects.toThrow('cancelled');
    pending.store.set(tokenSecretKey(server), '{}');
    await pending.service.forget(server);
    expect(pending.store.size).toBe(0);
  });

  it('reports unavailable discovery metadata', async () => {
    const { service } = harness({ fetch: () => Promise.resolve(jsonResponse({}, 404)) });
    await expect(service.tokenProvider(server).renew()).rejects.toThrow('metadata is unavailable');
  });
});
