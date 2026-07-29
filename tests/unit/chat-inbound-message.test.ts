import { describe, expect, it } from 'vitest';

import { inboundMessageSchema, promptRequestId } from '../../src/webview/chat-inbound-message';

describe('promptRequestId', () => {
  it('recovers a request UUID from an invalid prompt payload for scoped UI cleanup', () => {
    expect(
      promptRequestId({
        type: 'agent',
        requestId: '11c89732-7559-42d5-9ab1-c752ee98ea0d',
        attachments: [{ mimeType: 'audio/mpeg' }],
      }),
    ).toBe('11c89732-7559-42d5-9ab1-c752ee98ea0d');
  });

  it('does not correlate controls, malformed IDs, or unknown values', () => {
    expect(
      promptRequestId({
        type: 'logout',
        requestId: '11c89732-7559-42d5-9ab1-c752ee98ea0d',
      }),
    ).toBeUndefined();
    expect(promptRequestId({ type: 'agent', requestId: 'not-a-uuid' })).toBeUndefined();
    expect(promptRequestId(null)).toBeUndefined();
  });
});

describe('inboundMessageSchema', () => {
  it('bounds every compare model key as well as the model count', () => {
    const base = {
      attachments: [],
      content: 'Compare',
      contextMode: 'none',
      judgeEnabled: false,
      requestId: '11c89732-7559-42d5-9ab1-c752ee98ea0d',
      type: 'compare',
    };

    expect(
      inboundMessageSchema.safeParse({ ...base, modelKeys: ['', 'OLLAMA:qwen'] }).success,
    ).toBe(false);
    expect(
      inboundMessageSchema.safeParse({
        ...base,
        modelKeys: ['A'.repeat(501), 'OLLAMA:qwen'],
      }).success,
    ).toBe(false);
    expect(
      inboundMessageSchema.safeParse({
        ...base,
        modelKeys: ['OLLAMA:gemma', 'OLLAMA:qwen'],
      }).success,
    ).toBe(true);
  });
});
