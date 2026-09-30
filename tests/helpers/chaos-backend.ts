import { Buffer } from 'node:buffer';

import { BackendClient } from '../../src/backend/backend-client';
import { SessionVault, type SecretStoragePort } from '../../src/core/session-vault';

import type { PairingDeviceHint } from '../../src/backend/device-pairing-client';

export const CHAOS_BACKEND_URL = 'https://chaos.claw.example';
export const CHAOS_TIMEOUT_MS = 60;

/** Strings that must never reach a user-visible message. */
export const ACCESS_SECRET = 'chaos-access-token-SECRET';
export const REFRESH_SECRET = 'chaos-refresh-token-SECRET';
export const API_KEY_SECRET = 'sk-chaosapikey1234567890abcdef';

export const SECRET_MARKERS: readonly string[] = [ACCESS_SECRET, REFRESH_SECRET, API_KEY_SECRET];

/** What a scenario does to one request. `calls` counts every request that reached the network. */
export interface ChaosScenario {
  readonly name: string;
  readonly build: () => { fetcher: typeof fetch; calls: () => number };
  /** Requests one client call may make: the original plus at most one retry after a refresh. */
  readonly maxCalls: number;
}

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

function farFutureJwt(): string {
  const part = (value: object): string =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const exp = Math.floor(Date.now() / 1_000) + 3_600;
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ exp, sub: 'user-1' })}.${ACCESS_SECRET}`;
}

export async function chaosClient(fetcher: typeof fetch): Promise<BackendClient> {
  const vault = new SessionVault(new MemorySecrets());
  await vault.save(CHAOS_BACKEND_URL, {
    accessToken: farFutureJwt(),
    expiresIn: 3_600,
    refreshExpiresIn: 2_592_000,
    refreshToken: REFRESH_SECRET,
    tokenType: 'Bearer',
  });
  return new BackendClient({
    backendUrl: CHAOS_BACKEND_URL,
    fetcher,
    sessionVault: vault,
    timeoutMs: CHAOS_TIMEOUT_MS,
  });
}

const leakyBody = `{"message":"boom Bearer ${ACCESS_SECRET} api_key=${API_KEY_SECRET} refreshToken=${REFRESH_SECRET}"}`;

function counted(
  respond: (path: string, call: number) => Promise<Response>,
): ReturnType<ChaosScenario['build']> {
  let calls = 0;
  const fetcher: typeof fetch = async (input) => {
    calls += 1;
    return respond(new URL(input.toString()).pathname, calls);
  };
  return { fetcher, calls: () => calls };
}

function status(
  code: number,
  body: string,
  headers: Record<string, string> = {},
): ChaosScenario['build'] {
  return () => counted(() => Promise.resolve(new Response(body, { status: code, headers })));
}

function hangUntilAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    });
  });
}

function truncatedStream(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"data":[{"id":'));
      controller.error(new Error(`socket hang up Bearer ${ACCESS_SECRET}`));
    },
  });
  return new Response(stream, { status: 200 });
}

export const CHAOS_SCENARIOS: readonly ChaosScenario[] = [
  { name: 'HTTP 500 echoing secrets', build: status(500, leakyBody), maxCalls: 1 },
  { name: 'HTTP 503 with an HTML body', build: status(503, '<html>down</html>'), maxCalls: 1 },
  {
    name: 'HTTP 429 with Retry-After',
    build: status(429, leakyBody, { 'Retry-After': '30' }),
    maxCalls: 1,
  },
  { name: 'malformed JSON', build: status(200, '<html>not json'), maxCalls: 1 },
  { name: 'JSON of the wrong shape', build: status(200, '{"unexpected":true}'), maxCalls: 1 },
  { name: 'HTTP 404 from an older backend', build: status(404, ''), maxCalls: 1 },
  { name: 'HTTP 501 from an older backend', build: status(501, ''), maxCalls: 1 },
  {
    name: 'truncated body',
    build: () => counted(() => Promise.resolve(truncatedStream())),
    maxCalls: 1,
  },
  {
    name: 'DNS failure',
    build: () =>
      counted(() => {
        const cause = Object.assign(new Error('getaddrinfo ENOTFOUND chaos.claw.example'), {
          code: 'ENOTFOUND',
        });
        return Promise.reject(new TypeError(`fetch failed Bearer ${ACCESS_SECRET}`, { cause }));
      }),
    maxCalls: 1,
  },
  {
    name: 'a response that never arrives',
    build: () => {
      let signal: AbortSignal | null | undefined;
      const built = counted(() => hangUntilAborted(signal));
      const inner = built.fetcher;
      return {
        calls: built.calls,
        fetcher: (input, init) => {
          signal = init?.signal;
          return inner(input, init);
        },
      };
    },
    maxCalls: 1,
  },
  {
    name: 'expired token, refresh rejected',
    build: () =>
      counted((path) =>
        Promise.resolve(
          new Response(
            path.endsWith('/auth/refresh') ? '{"message":"Invalid refresh token"}' : '',
            {
              status: 401,
            },
          ),
        ),
      ),
    maxCalls: 2,
  },
  {
    name: 'expired token, refresh accepted, still 401',
    build: () =>
      counted((path) =>
        Promise.resolve(
          path.endsWith('/auth/refresh')
            ? Response.json({
                tokens: {
                  accessToken: farFutureJwt(),
                  expiresIn: 3_600,
                  refreshExpiresIn: 2_592_000,
                  refreshToken: 'rotated-refresh',
                  tokenType: 'Bearer',
                },
              })
            : new Response('', { status: 401 }),
        ),
      ),
    maxCalls: 3,
  },
];

export const PAIRING_HINT: PairingDeviceHint = {
  name: 'chaos',
  hostname: 'chaos-host',
  os: 'linux',
  platform: 'linux',
  agentVersion: '0.0.0',
};
