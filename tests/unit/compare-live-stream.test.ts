import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
}));

import { messageSchema, parallelResponseSchema } from '../../src/backend/contracts';
import { runCompare } from '../../src/services/compare-stream-collector';

import type { ChatMessage, ParallelResponse } from '../../src/backend/contracts';
import type { CompareLiveChange } from '../../src/core/compare-lane-accumulator.types';

/**
 * A Compare run captured from https://claw.local on 2026-10-01: kimi-k2.6 and
 * gpt-oss:120b with the judge on. Every frame here is what the server sent.
 */
const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), 'tests', 'fixtures', 'compare', 'real-compare-run.json'),
    'utf8',
  ),
) as { accepted: unknown; events: Record<string, unknown>[]; stored: unknown };
const run = {
  accepted: parallelResponseSchema.parse(fixture.accepted),
  events: fixture.events,
  stored: messageSchema.array().parse(fixture.stored),
};

function sse(events: readonly Record<string, unknown>[]): Response {
  return new Response(
    events
      .map(
        (event) => `data: ${JSON.stringify(event)}

`,
      )
      .join(''),
  );
}

async function replay(options?: { accepted?: ParallelResponse; stored?: ChatMessage[] }) {
  const live: CompareLiveChange[] = [];
  const progress: Record<string, unknown>[] = [];
  const result = await runCompare({
    backend: {
      compare: async () => options?.accepted ?? run.accepted,
      listMessages: async () => options?.stored ?? run.stored,
      openStream: async () => sse(run.events),
    },
    request: { content: 'q', models: [], judgeEnabled: true },
    signal: new AbortController().signal,
    onAccepted: vi.fn(),
    onLive: (change) => live.push(change),
    onProgress: (event) => progress.push(event),
  });
  return { live, progress, result };
}

/** The phases a lane passed through, with repeats (elapsed-time ticks) folded. */
function phases(live: readonly CompareLiveChange[], model: string) {
  return lanes(live, model)
    .map((lane) => lane.phase)
    .filter((phase, index, all) => phase !== all[index - 1]);
}

function lanes(live: readonly CompareLiveChange[], model: string) {
  return live.flatMap((change) =>
    change.kind === 'lane' && change.lane.model === model ? [change.lane] : [],
  );
}

describe('a real Compare run, replayed through the collector', () => {
  it('draws each lane as it connects and walks it connecting, thinking, generating, finishing', async () => {
    const { live } = await replay();

    expect(phases(live, 'gpt-oss:120b')).toEqual([
      'connecting',
      'thinking',
      'generating',
      'finishing',
    ]);
    expect(phases(live, 'kimi-k2.6')).toEqual(['connecting', 'generating', 'finishing']);
    const first = live[0];
    expect(first).toMatchObject({
      kind: 'lane',
      lane: { provider: 'OLLAMA', phase: 'connecting' },
    });
  });

  it('gives each lane its own text exactly once, so no lane bleeds into another', async () => {
    const { live } = await replay();

    const text = (model: string) =>
      lanes(live, model)
        .map((lane) => lane.delta)
        .join('');
    expect(text('gpt-oss:120b')).toBe(
      'The capital of France is Paris. It is famous for its historic landmarks, art, fashion, and cuisine. DONE',
    );
    expect(text('kimi-k2.6')).toContain('The capital of France is Paris.');
    expect(text('kimi-k2.6')).not.toContain('historic landmarks, art, fashion');
  });

  it('reports the elapsed time the server measured for the lane', async () => {
    const { live } = await replay();

    const last = lanes(live, 'kimi-k2.6').at(-1);
    expect(last).toMatchObject({ phase: 'finishing', elapsedMs: 3509 });
  });

  it('never carries the model reasoning text to the panel', async () => {
    const { live, progress } = await replay();

    expect(JSON.stringify(live)).not.toContain('reasoning text removed');
    expect(JSON.stringify(progress)).not.toContain('reasoning text removed');
  });

  it('keeps lane frames out of the progress feed and still reports the run stages', async () => {
    const { progress } = await replay();

    expect(progress.map((event) => event.label)).toEqual([
      'Request accepted',
      'Launching comparison',
      'Verifying answer',
      'Ranking the answers side by side',
      'Ranking the answers side by side',
      'Response complete',
    ]);
  });

  it('shows the judge ranking once, after the lanes, then hands over the stored verdict', async () => {
    const { live, result } = await replay();

    const kinds = live.map((change) => change.kind);
    expect(kinds.filter((kind) => kind === 'judge-ranking')).toHaveLength(1);
    expect(kinds.at(-1)).toBe('judge-verdict');
    expect(kinds.indexOf('judge-ranking')).toBeGreaterThan(kinds.lastIndexOf('lane'));
    expect(live.find((change) => change.kind === 'judge-ranking')).toEqual({
      kind: 'judge-ranking',
      judgeModel: 'OLLAMA/kimi-k2.6',
    });
    const verdict = live.at(-1);
    expect(verdict).toMatchObject({
      kind: 'judge-verdict',
      verdict: {
        status: 'ranked',
        winnerLaneIndex: 1,
        lanes: [
          { model: 'gpt-oss:120b', rank: 1, score: 9, label: 'B' },
          { model: 'kimi-k2.6', rank: 2, score: 8, label: 'A' },
        ],
      },
    });
    expect(result.judgeVerdict).toMatchObject({ status: 'ranked', winnerLaneIndex: 1 });
  });

  it('merges the stored latency and tokens into the same lanes it drew', async () => {
    const { result } = await replay();

    expect(result.responses.map((lane) => [lane.model, lane.latencyMs, lane.status])).toEqual([
      ['gpt-oss:120b', 1714, 'completed'],
      ['kimi-k2.6', 3409, 'completed'],
    ]);
  });

  it('reports no verdict, rather than inventing one, when the stored copy is unreadable', async () => {
    const { live, result } = await replay({ stored: [] });

    expect(live.at(-1)).toEqual({ kind: 'judge-verdict', verdict: null });
    expect(result.judgeVerdict).toBeNull();
    expect(result.responses.map((lane) => lane.content.length > 0)).toEqual([true, true]);
  });

  it('says nothing about a judge when the run did not ask for one', async () => {
    const { live, result } = await replay({
      accepted: { ...run.accepted, judgeEnabled: false },
      stored: [],
    });

    expect(live.some((change) => change.kind === 'judge-verdict')).toBe(false);
    expect('judgeVerdict' in result).toBe(false);
  });
});
