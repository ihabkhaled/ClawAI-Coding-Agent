import { describe, expect, it } from 'vitest';

import { parallelResponseSchema } from '../../src/backend/contracts';
import { CompareLaneAccumulator } from '../../src/core/compare-lane-accumulator';

const accepted = {
  messageId: 'group-1',
  threadId: 'thread-1',
  prompt: 'Compare these',
  responses: [],
  totalLatencyMs: 0,
  completedCount: 0,
  failedCount: 0,
  judgeEnabled: false,
  judgeModel: null,
};

describe('compare run accepted with no responses yet', () => {
  it('accepts the real body the server returns for an async compare', () => {
    expect(parallelResponseSchema.safeParse(accepted).success).toBe(true);
  });

  it('still rejects more than five lanes', () => {
    const lane = {
      provider: 'P',
      model: 'm',
      content: 'x',
      latencyMs: 1,
      inputTokens: null,
      outputTokens: null,
      status: 'completed',
      errorMessage: null,
    };
    expect(
      parallelResponseSchema.safeParse({ ...accepted, responses: Array(6).fill(lane) }).success,
    ).toBe(false);
  });
});

describe('CompareLaneAccumulator', () => {
  it('builds one result per lane from lane-tagged stream events and finishes on DONE', () => {
    const lanes = new CompareLaneAccumulator('group-1');
    lanes.apply({ type: 'DONE' });
    expect(lanes.finished).toBe(false);
    lanes.apply({
      type: 'CONTENT_DELTA',
      laneId: 'group-1:A:a',
      provider: 'A',
      model: 'a',
      delta: 'Hel',
    });
    lanes.apply({
      type: 'CONTENT_DELTA',
      laneId: 'group-1:B:b',
      provider: 'B',
      model: 'b',
      delta: 'Yo',
    });
    lanes.apply({
      type: 'CONTENT_DELTA',
      laneId: 'group-1:A:a',
      provider: 'A',
      model: 'a',
      delta: 'lo',
    });
    lanes.apply({
      type: 'USAGE',
      laneId: 'group-1:A:a',
      provider: 'A',
      model: 'a',
      usage: { promptTokens: 7, completionTokens: 3 },
    });
    lanes.apply({
      type: 'ERROR',
      laneId: 'group-1:B:b',
      provider: 'B',
      model: 'b',
      description: 'lane broke',
    });
    lanes.apply({
      type: 'CONTENT_DELTA',
      laneId: 'other:C:c',
      provider: 'C',
      model: 'c',
      delta: 'no',
    });
    lanes.apply({ type: 'DONE' });

    expect(lanes.finished).toBe(true);
    const result = lanes.result(accepted);
    expect(result.completedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.responses).toEqual([
      expect.objectContaining({
        provider: 'A',
        model: 'a',
        content: 'Hello',
        status: 'completed',
        inputTokens: 7,
        outputTokens: 3,
      }),
      expect.objectContaining({
        provider: 'B',
        model: 'b',
        status: 'failed',
        errorMessage: 'lane broke',
      }),
    ]);
    expect(
      parallelResponseSchema.safeParse({ ...result, responses: result.responses }).success,
    ).toBe(true);
  });

  it('treats an error with no lane as the whole run failing', () => {
    const lanes = new CompareLaneAccumulator('group-1');
    lanes.apply({
      type: 'CONTENT_DELTA',
      laneId: 'group-1:A:a',
      provider: 'A',
      model: 'a',
      delta: 'x',
    });
    expect(() => {
      lanes.apply({ type: 'ERROR', description: 'Parallel execution failed: no credit' });
    }).toThrow('Parallel execution failed: no credit');
  });
});

describe('CompareLaneAccumulator live changes', () => {
  const laneEvent = (type: string, extra: Record<string, unknown> = {}) => ({
    type,
    laneId: 'group-1:A:a',
    provider: 'A',
    model: 'a',
    ...extra,
  });

  it('draws a lane on its first frame, whatever that frame is', () => {
    const lanes = new CompareLaneAccumulator('group-1');

    const change = lanes.apply(laneEvent('LIFECYCLE', { stage: 'connecting_provider' }));

    expect(change).toEqual({
      kind: 'lane',
      lane: expect.objectContaining({ provider: 'A', model: 'a', phase: 'connecting', delta: '' }),
    });
  });

  it('reports a phase only when it changes, and never moves a lane backwards', () => {
    const lanes = new CompareLaneAccumulator('group-1');
    lanes.apply(laneEvent('LIFECYCLE', { stage: 'connecting_provider' }));

    expect(lanes.apply(laneEvent('REASONING_DELTA', { reasoningDelta: 'secret' }))).toMatchObject({
      lane: { phase: 'thinking' },
    });
    expect(lanes.apply(laneEvent('REASONING_DELTA', { reasoningDelta: 'more' }))).toBeUndefined();
    expect(lanes.apply(laneEvent('CONTENT_DELTA', { delta: 'Hi' }))).toMatchObject({
      lane: { phase: 'generating', delta: 'Hi' },
    });
    expect(lanes.apply(laneEvent('LIFECYCLE', { stage: 'thinking' }))).toBeUndefined();
    expect(lanes.apply(laneEvent('LIFECYCLE', { stage: 'retrieving_context' }))).toBeUndefined();
  });

  it('never puts reasoning text on a change', () => {
    const lanes = new CompareLaneAccumulator('group-1');

    const change = lanes.apply(
      laneEvent('REASONING_DELTA', { reasoningDelta: 'my private chain' }),
    );

    expect(JSON.stringify(change)).not.toContain('my private chain');
  });

  it('finishes a lane on the 96 percent metrics frame and records the elapsed time', () => {
    const lanes = new CompareLaneAccumulator('group-1');
    lanes.apply(laneEvent('CONTENT_DELTA', { delta: 'x' }));

    expect(
      lanes.apply(laneEvent('METRICS', { metrics: { elapsedMs: 2463, progressPercent: 45 } })),
    ).toMatchObject({ lane: { phase: 'generating', elapsedMs: 2463 } });
    expect(
      lanes.apply(laneEvent('METRICS', { metrics: { elapsedMs: 2500, progressPercent: 96 } })),
    ).toMatchObject({ lane: { phase: 'finishing', elapsedMs: 2500 } });
    expect(lanes.apply(laneEvent('METRICS', { metrics: 'not an object' }))).toBeUndefined();
    expect(lanes.result(accepted).responses[0]).toMatchObject({ latencyMs: 2500 });
  });

  it('marks a lane failed and keeps it failed', () => {
    const lanes = new CompareLaneAccumulator('group-1');
    lanes.apply(laneEvent('CONTENT_DELTA', { delta: 'x' }));

    expect(lanes.apply(laneEvent('ERROR', { description: 'quota' }))).toMatchObject({
      lane: { phase: 'failed', errorMessage: 'quota' },
    });
    expect(
      lanes.apply(laneEvent('METRICS', { metrics: { elapsedMs: 9, progressPercent: 96 } })),
    ).toMatchObject({ lane: { phase: 'failed' } });
  });

  it('reports usage tokens on the lane', () => {
    const lanes = new CompareLaneAccumulator('group-1');

    expect(
      lanes.apply(laneEvent('USAGE', { usage: { promptTokens: 12, completionTokens: 4 } })),
    ).toMatchObject({ lane: { inputTokens: 12, outputTokens: 4 } });
  });

  it('ignores frames of another run on the same thread', () => {
    const lanes = new CompareLaneAccumulator('group-1');

    expect(
      lanes.apply({
        type: 'CONTENT_DELTA',
        laneId: 'other:A:a',
        delta: 'x',
        provider: 'A',
        model: 'a',
      }),
    ).toBeUndefined();
  });

  it('reports the judge once, only after a lane has spoken', () => {
    const lanes = new CompareLaneAccumulator('group-1');
    const judge = { type: 'JUDGE_EVALUATING', judgeModel: 'OLLAMA/kimi-k2.6' };
    const stage = {
      type: 'RESPONSE_STREAMING',
      status: 'active',
      stageId: 'compare-judge:OLLAMA/kimi-k2.6',
      description: 'OLLAMA/kimi-k2.6',
    };

    expect(lanes.apply(judge)).toBeUndefined();
    lanes.apply(laneEvent('CONTENT_DELTA', { delta: 'x' }));
    expect(lanes.apply(judge)).toEqual({ kind: 'judge-ranking', judgeModel: 'OLLAMA/kimi-k2.6' });
    expect(lanes.apply(stage)).toBeUndefined();
  });

  it('also recognises the judge from its orchestration stage alone', () => {
    const lanes = new CompareLaneAccumulator('group-1');
    lanes.apply(laneEvent('CONTENT_DELTA', { delta: 'x' }));

    expect(
      lanes.apply({
        type: 'RESPONSE_STREAMING',
        status: 'completed',
        stageId: 'compare-judge:J',
        description: 'J',
      }),
    ).toBeUndefined();
    expect(
      lanes.apply({
        type: 'RESPONSE_STREAMING',
        status: 'active',
        stageId: 'compare-judge:J',
        description: 'J',
      }),
    ).toEqual({ kind: 'judge-ranking', judgeModel: 'J' });
  });
});
