import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
}));

import { runCompare } from '../../src/services/compare-stream-collector';
import { parallelResponse } from '../helpers/parallel-response';

import type { CompareBackend } from '../../src/services/compare-stream-collector.types';

const GROUP = 'group-9';

function sse(events: readonly Record<string, unknown>[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''));
}

const lane = (provider: string, model: string, delta: string) => ({
  type: 'content_delta',
  laneId: `${GROUP}:${provider}:${model}`,
  provider,
  model,
  delta,
});

function backend(options: { stream: Response; body?: ReturnType<typeof parallelResponse> }) {
  const compare = vi.fn(
    async () => options.body ?? { ...parallelResponse(), messageId: GROUP, responses: [] },
  );
  const openStream = vi.fn(async () => options.stream);
  const listMessages = vi.fn(async () => [
    {
      id: 'm1',
      threadId: 'thread-from-compare',
      role: 'ASSISTANT',
      content: 'Alpha',
      provider: 'A',
      model: 'a',
      latencyMs: 1234,
      metadata: { parallelGroupId: GROUP, judgeReview: { rank: 1 } },
    },
  ]);
  return { compare, openStream, listMessages } as unknown as CompareBackend & {
    compare: typeof compare;
    openStream: typeof openStream;
    listMessages: typeof listMessages;
  };
}

const request = { content: 'q', models: [], judgeEnabled: true };

describe('runCompare against a server that accepts the run and streams the lanes', () => {
  it('reads each lane and the judge verdict, shows progress, and opens the stream before the request when the thread is known', async () => {
    const fake = backend({
      stream: sse([
        { type: 'response-streaming', label: 'Launching comparison' },
        lane('A', 'a', 'Alpha'),
        lane('B', 'b', 'Beta'),
        { type: 'judge_evaluating', label: 'Ranking the answers side by side' },
        { type: 'done' },
      ]),
    });
    const progress: Record<string, unknown>[] = [];
    const accepted = vi.fn();

    const result = await runCompare({
      backend: fake,
      request: { ...request, threadId: 'thread-existing' },
      signal: new AbortController().signal,
      onAccepted: accepted,
      onProgress: (event) => progress.push(event),
    });

    expect(fake.openStream).toHaveBeenCalledWith('thread-existing', expect.any(AbortSignal), false);
    expect(fake.openStream.mock.invocationCallOrder[0]).toBeLessThan(
      fake.compare.mock.invocationCallOrder[0] ?? 0,
    );
    expect(accepted).toHaveBeenCalledWith('thread-from-compare');
    expect(progress.map((event) => event.label)).toEqual([
      'Launching comparison',
      'Ranking the answers side by side',
    ]);
    expect(result.responses.map((entry) => entry.content)).toEqual(['Alpha', 'Beta']);
    expect(result.responses[0]).toMatchObject({ latencyMs: 1234, judgeReview: { rank: 1 } });
    expect(result.completedCount).toBe(2);
  });

  it('replays the stream when the server created the thread', async () => {
    const fake = backend({ stream: sse([lane('A', 'a', 'x'), { type: 'done' }]) });

    await runCompare({
      backend: fake,
      request,
      signal: new AbortController().signal,
      onAccepted: vi.fn(),
      onProgress: vi.fn(),
    });

    expect(fake.openStream).toHaveBeenCalledWith(
      'thread-from-compare',
      expect.any(AbortSignal),
      true,
    );
  });

  it('fails when the stream closes before the run is done', async () => {
    const fake = backend({ stream: sse([lane('A', 'a', 'x')]) });

    await expect(
      runCompare({
        backend: fake,
        request,
        signal: new AbortController().signal,
        onAccepted: vi.fn(),
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow('closed before the request completed');
  });

  it('returns a body that already carries the lanes without reading the stream', async () => {
    const fake = backend({ stream: sse([]), body: parallelResponse() });

    const result = await runCompare({
      backend: fake,
      request: { ...request, threadId: 'thread-existing' },
      signal: new AbortController().signal,
      onAccepted: vi.fn(),
      onProgress: vi.fn(),
    });

    expect(result.responses).toHaveLength(2);
    expect(fake.listMessages).not.toHaveBeenCalled();
  });
});
