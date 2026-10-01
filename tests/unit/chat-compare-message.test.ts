import { describe, expect, it } from 'vitest';

import { toCompareLiveMessage } from '../../src/webview/chat-compare-message';

import type { CompareLiveChange } from '../../src/core/compare-lane-accumulator.types';

const REQUEST = '3f1d6b8e-5a56-4d3e-9b7f-0a1b2c3d4e5f';

const lane: Extract<CompareLiveChange, { kind: 'lane' }>['lane'] = {
  delta: 'Hello',
  elapsedMs: 1200,
  errorMessage: null,
  inputTokens: null,
  laneId: 'group:OLLAMA:kimi-k2.6',
  model: 'kimi-k2.6',
  outputTokens: null,
  phase: 'generating',
  provider: 'OLLAMA',
};

describe('toCompareLiveMessage', () => {
  it('maps a lane change to the compareLane message the panel renders', () => {
    expect(toCompareLiveMessage({ kind: 'lane', lane }, REQUEST)).toEqual({
      type: 'compareLane',
      requestId: REQUEST,
      lane,
    });
  });

  it('maps the judge starting and the verdict arriving', () => {
    expect(
      toCompareLiveMessage({ kind: 'judge-ranking', judgeModel: 'OLLAMA/kimi-k2.6' }, REQUEST),
    ).toEqual({
      type: 'compareJudge',
      phase: 'ranking',
      requestId: REQUEST,
      judgeModel: 'OLLAMA/kimi-k2.6',
    });
    expect(toCompareLiveMessage({ kind: 'judge-verdict', verdict: null }, REQUEST)).toEqual({
      type: 'compareJudge',
      phase: 'verdict',
      requestId: REQUEST,
      verdict: null,
    });
  });

  it('carries a ranked verdict through unchanged', () => {
    const verdict = {
      judgeModel: 'OLLAMA/kimi-k2.6',
      lanes: [
        {
          label: 'A',
          laneIndex: 0,
          model: 'kimi-k2.6',
          provider: 'OLLAMA',
          rank: 1,
          reason: 'Clear.',
          score: 9,
        },
      ],
      rationale: 'A is clearer.',
      scale: { max: 10, min: 0 },
      status: 'ranked' as const,
      tiedLaneIndices: [],
      winnerLaneIndex: 0,
    };

    expect(toCompareLiveMessage({ kind: 'judge-verdict', verdict }, REQUEST)).toMatchObject({
      verdict,
    });
  });

  it('drops a change for a request id that is not a UUID', () => {
    expect(toCompareLiveMessage({ kind: 'lane', lane }, 'not-a-uuid')).toBeNull();
  });

  it('drops a lane change that is malformed rather than half-drawing a card', () => {
    expect(
      toCompareLiveMessage({ kind: 'lane', lane: { ...lane, elapsedMs: -5 } }, REQUEST),
    ).toBeNull();
    expect(
      toCompareLiveMessage({ kind: 'lane', lane: { ...lane, laneId: '' } }, REQUEST),
    ).toBeNull();
    expect(
      toCompareLiveMessage(
        { kind: 'lane', lane: { ...lane, phase: 'exploding' as 'failed' } },
        REQUEST,
      ),
    ).toBeNull();
  });
});
