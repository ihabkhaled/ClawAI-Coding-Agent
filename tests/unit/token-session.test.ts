import { describe, expect, it } from 'vitest';

import { RuntimeHttpError } from '../../src/headless/runtime-http-error';
import { TokenSession } from '../../src/headless/token-session';
import { sentinelJwt } from '../helpers/short-token-server';

function harness(options: { ttlSeconds: number; answer?: () => Response | Promise<Response> }) {
  const clock = { now: 1_000_000 };
  const calls: string[] = [];
  let serial = 0;
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(init?.body));
    if (options.answer !== undefined) return options.answer();
    serial += 1;
    const exp = Math.floor(clock.now / 1000) + options.ttlSeconds;
    return Response.json({
      tokens: {
        accessToken: sentinelJwt(exp, serial),
        refreshToken: `SENTINEL-r${String(serial)}`,
      },
    });
  }) as typeof fetch;
  const first = sentinelJwt(Math.floor(clock.now / 1000) + options.ttlSeconds, 0);
  const session = new TokenSession({
    baseUrl: 'http://backend',
    tokens: { accessToken: first, refreshToken: 'SENTINEL-r0' },
    now: () => clock.now,
    fetch: fetcher,
    retry: { maxAttempts: 1 },
  });
  return { session, clock, calls, first };
}

describe('TokenSession', () => {
  it('leaves a fresh token alone and rotates one that is about to expire', async () => {
    const { session, clock, calls, first } = harness({ ttlSeconds: 900 });
    expect(await session.fresh()).toBe(first);
    expect(calls).toHaveLength(0);
    clock.now += 850_000; // inside the 60 s skew
    const next = await session.fresh();
    expect(next).not.toBe(first);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('SENTINEL-r0');
  });

  it('schedules rotation at 80% of the life, and 10 minutes when the life is unreadable', () => {
    const jwt = harness({ ttlSeconds: 1000 });
    expect(jwt.session.msUntilRotation()).toBe(800_000);
    const opaque = new TokenSession({
      baseUrl: 'http://backend',
      tokens: { accessToken: 'opaque', refreshToken: 'r' },
      now: () => 5,
    });
    expect(opaque.msUntilRotation()).toBe(600_000);
  });

  it('shares one rotation between concurrent callers and replaces the refresh token', async () => {
    const { session, clock, calls } = harness({ ttlSeconds: 900 });
    clock.now += 890_000;
    const tokens = await Promise.all([session.fresh(), session.fresh(), session.fresh()]);
    expect(calls).toHaveLength(1);
    expect(new Set(tokens).size).toBe(1);
    clock.now += 890_000;
    await session.fresh();
    expect(calls[1]).toContain('SENTINEL-r1'); // the rotated one, not the first
  });

  it('does not rotate again for a rejection of a token it already replaced', async () => {
    const { session, clock, calls, first } = harness({ ttlSeconds: 900 });
    clock.now += 890_000;
    await session.fresh();
    await session.renewAfterRejection(first);
    expect(calls).toHaveLength(1);
  });

  it('has nothing to rotate with for a static token', async () => {
    const session = new TokenSession({ baseUrl: 'http://b', tokens: { accessToken: 'static' } });
    expect(session.canRefresh()).toBe(false);
    expect(session.msUntilRotation()).toBeUndefined();
    expect(await session.fresh()).toBe('static');
    await expect(session.renewAfterRejection('static')).rejects.toMatchObject({ status: 401 });
  });

  it('treats a refused refresh as final and never asks again', async () => {
    const { session, clock, calls } = harness({
      ttlSeconds: 900,
      answer: () => new Response('{"message":"SENTINEL-r0 revoked"}', { status: 401 }),
    });
    clock.now += 2_000_000; // expired, so the failure cannot be hidden
    const error = await session.fresh().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RuntimeHttpError);
    expect((error as RuntimeHttpError).status).toBe(401);
    expect((error as RuntimeHttpError).message).not.toContain('SENTINEL');
    await session.fresh().catch(() => undefined);
    expect(calls).toHaveLength(1);
    expect(session.canRefresh()).toBe(false);
  });

  it('keeps using a still-valid token when an early rotation fails for a passing reason', async () => {
    const { session, clock, first } = harness({
      ttlSeconds: 900,
      answer: () => new Response('down', { status: 503 }),
    });
    clock.now += 890_000;
    expect(await session.fresh()).toBe(first);
  });

  it('refuses an answer that carries no access token without losing the old pair', async () => {
    const { session, clock, first } = harness({
      ttlSeconds: 900,
      answer: () => Response.json({ tokens: {} }),
    });
    clock.now += 2_000_000;
    await expect(session.fresh()).rejects.toMatchObject({ status: 502 });
    expect(session.current()).toBe(first);
    expect(session.canRefresh()).toBe(true);
  });
});
