import { afterEach, describe, expect, it, vi } from 'vitest';

import { accessTokenExpiresAt } from '../../src/core/access-token-expiry';
import { HeadlessTransport } from '../../src/headless/headless-transport';
import { runAgent } from '../../src/sdk/agent-sdk';
import { startShortTokenServer } from '../helpers/short-token-server';

import type { HeadlessStreamEvent } from '../../src/headless/headless-session.types';
import type { ShortTokenServer } from '../helpers/short-token-server';

const toolkit = { definitions: [], execute: () => ({ ok: true }) };
let server: ShortTokenServer | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await server?.close();
  server = undefined;
});

/** Runs a whole agent run against the fake backend and returns everything it could have leaked into. */
async function run(options: {
  ttlSeconds: number;
  everyMs: number;
  events: number;
  refuseFrom?: number;
  refreshDelayMs?: number;
}) {
  server = await startShortTokenServer(options);
  if (options.refuseFrom !== undefined) server.refuseRefreshesFrom(options.refuseFrom);
  const output: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  const retries: string[] = [];
  const transport = new HeadlessTransport(server.url, {
    onRetry: (notice) => retries.push(JSON.stringify(notice)),
  });
  const pair = server.mint();
  transport.adoptSession({ accessToken: pair.accessToken, refreshToken: pair.refreshToken });
  const events: HeadlessStreamEvent[] = [];
  const outcome = await runAgent({
    prompt: 'go',
    toolkit,
    token: pair.accessToken,
    transport,
    deadlineMs: 60_000,
    onEvent: (event) => events.push(event),
  }).then(
    (report) => ({ report, error: undefined }),
    (error: unknown) => ({ report: undefined, error }),
  );
  return { server, outcome, events, output, retries };
}

/** Waits until `offsetMs` after the token's expiry (negative: before it). */
const waitUntilExpiry = async (token: string, offsetMs: number): Promise<void> => {
  const expiresAt = accessTokenExpiresAt(token) ?? 0;
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, expiresAt + offsetMs - Date.now())),
  );
};

const leaked = (...parts: unknown[]): boolean => JSON.stringify(parts).includes('SENTINEL');

describe('a run longer than the access token', () => {
  it('completes a 20 second run on 2 second tokens, refreshing and resuming from the cursor', async () => {
    const result = await run({ ttlSeconds: 2, everyMs: 1_000, events: 20 });
    expect(result.outcome.error).toBeUndefined();
    expect(result.outcome.report?.outcome).toBe('completed');
    expect(result.outcome.report?.toolCalls).toBe(19);
    expect(result.server.log.refreshes).toBeGreaterThanOrEqual(8);
    // Every reconnect carried the cursor: it never went back and never replayed from the start.
    const afters = result.server.log.streamAfters;
    expect(afters.length).toBeGreaterThan(5);
    expect(afters).toEqual([...afters].sort((left, right) => left - right));
    expect(Math.max(...afters)).toBeGreaterThan(10);
    expect(afters.filter((after) => after === 0).length).toBeLessThanOrEqual(1);
    // Rotation happened before expiry, so no request was ever refused.
    expect(result.server.log.unauthorized).toBe(0);
    expect(result.server.log.results).toBe(19);
    expect(leaked(result.events, result.output, result.retries)).toBe(false);
  }, 60_000);

  it('ends with a clear 401 and no token in the error when a refresh is refused mid-run', async () => {
    const result = await run({ ttlSeconds: 2, everyMs: 700, events: 30, refuseFrom: 2 });
    const error = result.outcome.error as { status?: number; message?: string } | undefined;
    expect(error?.status).toBe(401);
    expect(error?.message).toContain('could not be renewed');
    expect(leaked(error?.message, result.events, result.output, result.retries)).toBe(false);
    expect(result.server.log.refreshes).toBe(3);
  }, 30_000);

  it('shares one refresh between tool results submitted at the same moment', async () => {
    server = await startShortTokenServer({
      ttlSeconds: 2,
      everyMs: 1_000,
      events: 1,
      refreshDelayMs: 150,
    });
    const transport = new HeadlessTransport(server.url);
    const pair = server.mint();
    transport.adoptSession({ accessToken: pair.accessToken, refreshToken: pair.refreshToken });
    await waitUntilExpiry(pair.accessToken, -150); // inside the request skew
    const run = { runId: 'run-1', generation: 'g1', threadId: 'thread-1' };
    await Promise.all(
      Array.from({ length: 6 }, () => transport.submitResult(pair.accessToken, run, {}, {})),
    );
    expect(server.log.refreshes).toBe(1);
    expect(server.log.results).toBe(6);
    expect(server.log.unauthorized).toBe(0);
  });

  it('renews once and retries when the backend rejects a token the clock still trusted', async () => {
    server = await startShortTokenServer({ ttlSeconds: 2, everyMs: 1_000, events: 1 });
    const transport = new HeadlessTransport(server.url);
    const pair = server.mint();
    transport.adoptSession({ accessToken: pair.accessToken, refreshToken: pair.refreshToken });
    await waitUntilExpiry(pair.accessToken, 100); // already expired; fresh() rotates first
    const id = await transport.createThread(pair.accessToken, 't');
    expect(id).toBe('thread-1');
    expect(server.log.refreshes).toBe(1);
  });

  it('without a refresh token a static token is used as given', async () => {
    server = await startShortTokenServer({ ttlSeconds: 60, everyMs: 100, events: 3 });
    const transport = new HeadlessTransport(server.url);
    const pair = server.mint();
    const report = await runAgent({
      prompt: 'go',
      toolkit,
      token: pair.accessToken,
      transport,
      deadlineMs: 20_000,
    });
    expect(report.outcome).toBe('completed');
    expect(server.log.refreshes).toBe(0);
  });
});
