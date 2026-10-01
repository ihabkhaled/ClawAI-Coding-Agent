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
