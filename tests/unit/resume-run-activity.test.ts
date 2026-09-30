import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackendRequestError } from '../../src/backend/backend-errors';
import { remoteSessionClient } from '../../src/backend/remote-session-client';
import { resolveRunActivity } from '../../src/core/resume-readiness';
import { HeadlessTransport } from '../../src/headless/headless-transport';

const unsupported = (error: unknown): boolean =>
  error instanceof BackendRequestError && error.status === 404;

describe('resolveRunActivity (F095)', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  const recentPrompt = [{ role: 'USER', createdAt: new Date(now - 60_000).toISOString() }];

  it("uses the backend's answer and never reads the transcript", async () => {
    const transcript = vi.fn();

    await expect(
      resolveRunActivity({
        query: async () => ({ active: false }),
        isUnsupported: unsupported,
        transcript,
        now,
      }),
    ).resolves.toBe(false);
    await expect(
      resolveRunActivity({
        query: async () => ({ active: true }),
        isUnsupported: unsupported,
        transcript,
        now,
      }),
    ).resolves.toBe(true);
    expect(transcript).not.toHaveBeenCalled();
  });

  it('trusts a finished run over a recent unanswered prompt', async () => {
    // The old guess would call this live for ten minutes.
    await expect(
      resolveRunActivity({
        query: async () => ({ active: false }),
        isUnsupported: unsupported,
        transcript: async () => recentPrompt,
        now,
      }),
    ).resolves.toBe(false);
  });

  it('falls back to the transcript guess only on a 404 from an older backend', async () => {
    const transcript = vi.fn().mockResolvedValue(recentPrompt);

    await expect(
      resolveRunActivity({
        query: () => Promise.reject(new BackendRequestError('Not found', 404, false)),
        isUnsupported: unsupported,
        transcript,
        now,
      }),
    ).resolves.toBe(true);
    expect(transcript).toHaveBeenCalledOnce();
  });

  it('does not read any other failure as "not running"', async () => {
    const outage = new BackendRequestError('Unavailable', 503, true);
    const transcript = vi.fn();

    await expect(
      resolveRunActivity({
        query: () => Promise.reject(outage),
        isUnsupported: unsupported,
        transcript,
        now,
      }),
    ).rejects.toBe(outage);
    expect(transcript).not.toHaveBeenCalled();
  });
});

describe('remoteSessionClient.activeRun', () => {
  it('asks the thread-scoped query with the id encoded', async () => {
    const request = vi.fn().mockResolvedValue({ active: true, runId: 'run-1' });

    await expect(remoteSessionClient.activeRun(request, 'a/b')).resolves.toEqual({
      active: true,
      runId: 'run-1',
    });
    expect(request.mock.calls[0]?.[0]).toBe('/chat-threads/a%2Fb/active-run');
  });
});

describe('HeadlessTransport.createThread (F094)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function respond(status: number, body: string): Response {
    return new Response(body, { status });
  }

  function sentOrigins(fetchMock: ReturnType<typeof vi.fn>): unknown[] {
    return fetchMock.mock.calls.map(
      (call) => (JSON.parse(String((call[1] as RequestInit).body)) as { origin: unknown }).origin,
    );
  }

  it('creates the thread with the CLI origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(201, '{"id":"t1"}'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new HeadlessTransport('https://x').createThread('tok', 'Title')).resolves.toBe(
      't1',
    );
    expect(sentOrigins(fetchMock)).toEqual(['CODING_AGENT_CLI']);
  });

  it('falls back to the shared agent origin when an older backend rejects the CLI one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(400, '{"message":"Invalid enum value"}'))
      .mockResolvedValueOnce(respond(201, '{"id":"t2"}'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new HeadlessTransport('https://x').createThread('tok', 'Title')).resolves.toBe(
      't2',
    );
    expect(sentOrigins(fetchMock)).toEqual(['CODING_AGENT_CLI', 'CODING_AGENT']);
  });

  it('does not retry a failure that is not a rejected origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(401, 'no'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new HeadlessTransport('https://x').createThread('tok', 'Title')).rejects.toThrow(
      /401/,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
