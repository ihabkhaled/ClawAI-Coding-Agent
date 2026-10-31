import { describe, expect, it } from 'vitest';

import { toCompactionOfferMessage } from '../../src/webview/chat-compaction-offer';
import { inboundMessageSchema } from '../../src/webview/chat-inbound-message';

const ID = '11111111-1111-4111-8111-111111111111';

describe('toCompactionOfferMessage', () => {
  it('builds the host to panel message for a valid offer', () => {
    expect(toCompactionOfferMessage({ requestId: ID, threadId: 't-1', usedPercent: 92 })).toEqual({
      type: 'compactionOffer',
      requestId: ID,
      threadId: 't-1',
      usedPercent: 92,
    });
  });

  it.each([
    ['a non-UUID id', { requestId: 'nope', threadId: 't-1', usedPercent: 92 }],
    ['an empty thread', { requestId: ID, threadId: '', usedPercent: 92 }],
    ['a percent above 100', { requestId: ID, threadId: 't-1', usedPercent: 101 }],
    ['a negative percent', { requestId: ID, threadId: 't-1', usedPercent: -1 }],
    ['a fractional percent', { requestId: ID, threadId: 't-1', usedPercent: 9.5 }],
    ['a NaN percent', { requestId: ID, threadId: 't-1', usedPercent: Number.NaN }],
  ])('refuses %s', (_name, offer) => {
    expect(toCompactionOfferMessage(offer)).toBeNull();
  });
});

describe('compactionDecision inbound message', () => {
  it('accepts a decision with a UUID and a boolean', () => {
    expect(
      inboundMessageSchema.parse({ type: 'compactionDecision', requestId: ID, accept: false }),
    ).toEqual({ type: 'compactionDecision', requestId: ID, accept: false });
  });

  it.each([
    ['a missing id', { type: 'compactionDecision', accept: true }],
    ['a non-UUID id', { type: 'compactionDecision', requestId: 'x', accept: true }],
    ['a string accept', { type: 'compactionDecision', requestId: ID, accept: 'yes' }],
    ['a missing accept', { type: 'compactionDecision', requestId: ID }],
  ])('rejects %s', (_name, message) => {
    expect(inboundMessageSchema.safeParse(message).success).toBe(false);
  });
});

describe('compactionOfferShown inbound message', () => {
  it('accepts a confirmation with a UUID', () => {
    expect(inboundMessageSchema.parse({ type: 'compactionOfferShown', requestId: ID })).toEqual({
      type: 'compactionOfferShown',
      requestId: ID,
    });
  });

  it.each([
    ['a missing id', { type: 'compactionOfferShown' }],
    ['a non-UUID id', { type: 'compactionOfferShown', requestId: 'x' }],
  ])('rejects %s', (_name, message) => {
    expect(inboundMessageSchema.safeParse(message).success).toBe(false);
  });
});
