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
  it('accepts the bounded display-language control', () => {
    expect(inboundMessageSchema.parse({ type: 'configureLanguage' })).toEqual({
      type: 'configureLanguage',
    });
  });

  it('accepts only selectable local and custom connection profiles', () => {
    const custom = {
      type: 'configureConnections',
      backendEnvironment: 'CUSTOM',
      backendCustomUrl: 'https://api.example.com',
      frontendEnvironment: 'CUSTOM',
      frontendCustomUrl: 'https://app.example.com',
    };
    expect(inboundMessageSchema.safeParse(custom).success).toBe(true);
    expect(
      inboundMessageSchema.safeParse({
        ...custom,
        backendEnvironment: 'CLOUD',
      }).success,
    ).toBe(false);
  });

  it('accepts a request-scoped cancellation and rejects a malformed target', () => {
    const requestId = '11c89732-7559-42d5-9ab1-c752ee98ea0d';
    expect(inboundMessageSchema.parse({ type: 'cancel', requestId })).toEqual({
      type: 'cancel',
      requestId,
    });
    expect(
      inboundMessageSchema.safeParse({ type: 'cancel', requestId: 'not-a-uuid' }).success,
    ).toBe(false);
    expect(inboundMessageSchema.safeParse({ type: 'cancel' }).success).toBe(true);
  });

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

  it('defaults research off and accepts an explicit bounded research mode', () => {
    const base = {
      attachments: [],
      content: 'Find current documentation',
      contextMode: 'none',
      modelKey: 'OLLAMA:gpt-oss:20b-cloud',
      requestId: '11c89732-7559-42d5-9ab1-c752ee98ea0d',
      type: 'send',
    };

    expect(inboundMessageSchema.parse(base)).toMatchObject({ researchMode: 'NONE' });
    expect(inboundMessageSchema.parse({ ...base, researchMode: 'SEARCH_FETCH' })).toMatchObject({
      researchMode: 'SEARCH_FETCH',
    });
    expect(inboundMessageSchema.safeParse({ ...base, researchMode: 'UNBOUNDED' }).success).toBe(
      false,
    );
  });
});
