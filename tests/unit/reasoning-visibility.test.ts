import { describe, expect, it } from 'vitest';

import {
  accumulateReasoning,
  isReasoningEvent,
  redactReasoningEvent,
} from '../../src/core/reasoning-visibility';

const CHAIN_OF_THOUGHT =
  'The user asked for the admin password. It is hunter2, but I should refuse.';

describe('redactReasoningEvent', () => {
  it('replaces a reasoning delta with its size and keeps no trace of the text', () => {
    const redacted = redactReasoningEvent({
      type: 'REASONING_DELTA',
      delta: CHAIN_OF_THOUGHT,
      requestId: 'req-1',
    });

    expect(redacted).toEqual({
      type: 'REASONING_DELTA',
      requestId: 'req-1',
      redacted: true,
      deltaTokens: 19,
    });
    expect(JSON.stringify(redacted)).not.toContain('hunter2');
  });

  it('strips every field a reasoning event could carry the text in', () => {
    const redacted = redactReasoningEvent({
      type: 'REASONING_DELTA',
      delta: 'a',
      content: CHAIN_OF_THOUGHT,
      reasoning: CHAIN_OF_THOUGHT,
    });

    expect(redacted.delta).toBeUndefined();
    expect(redacted.content).toBeUndefined();
    expect(redacted.reasoning).toBeUndefined();
    expect(JSON.stringify(redacted)).not.toContain('hunter2');
  });

  it('falls back to a later field when the first one is absent', () => {
    const redacted = redactReasoningEvent({ type: 'REASONING_DELTA', reasoning: 'abcd' });

    expect(redacted.deltaTokens).toBe(1);
  });

  it('reports zero tokens for a reasoning event that carries no text at all', () => {
    expect(redactReasoningEvent({ type: 'REASONING_DELTA' }).deltaTokens).toBe(0);
  });

  it('leaves every other event untouched and identical', () => {
    const event = { type: 'CONTENT_DELTA', delta: 'the answer' };

    expect(redactReasoningEvent(event)).toBe(event);
    expect(isReasoningEvent(event)).toBe(false);
  });

  it('does not mutate the event it was given', () => {
    const event = { type: 'REASONING_DELTA', delta: CHAIN_OF_THOUGHT };
    redactReasoningEvent(event);

    expect(event.delta).toBe(CHAIN_OF_THOUGHT);
  });
});

describe('accumulateReasoning', () => {
  it('adds up the sizes and counts the steps', () => {
    const first = accumulateReasoning(undefined, {
      type: 'REASONING_DELTA',
      deltaTokens: 12,
    });
    const second = accumulateReasoning(first, { type: 'REASONING_DELTA', deltaTokens: 8 });

    expect(second).toEqual({ tokens: 20, segments: 2 });
  });

  it('still counts a step whose size is missing or unusable', () => {
    const status = accumulateReasoning(
      { tokens: 5, segments: 1 },
      {
        type: 'REASONING_DELTA',
        deltaTokens: Number.NaN,
      },
    );

    expect(status).toEqual({ tokens: 5, segments: 2 });
  });

  it('ignores an event that is not about reasoning', () => {
    expect(accumulateReasoning(undefined, { type: 'CONTENT_DELTA', delta: 'x' })).toEqual({
      tokens: 0,
      segments: 0,
    });
  });
});
