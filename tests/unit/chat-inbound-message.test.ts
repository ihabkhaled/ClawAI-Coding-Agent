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
  it('accepts bounded runtime controls', () => {
    expect(inboundMessageSchema.parse({ type: 'runtimePause' })).toEqual({ type: 'runtimePause' });
    expect(inboundMessageSchema.parse({ type: 'runtimeResume' })).toEqual({
      type: 'runtimeResume',
    });
    expect(inboundMessageSchema.parse({ type: 'runtimeStop' })).toEqual({ type: 'runtimeStop' });
    expect(
      inboundMessageSchema.parse({ type: 'runtimeSteer', message: 'Prioritize tests.' }),
    ).toEqual({
      type: 'runtimeSteer',
      message: 'Prioritize tests.',
    });
    expect(inboundMessageSchema.safeParse({ type: 'runtimeSteer', message: '' }).success).toBe(
      false,
    );
    expect(
      inboundMessageSchema.safeParse({ type: 'runtimeSteer', message: 'x'.repeat(20_001) }).success,
    ).toBe(false);
  });

  it('accepts the bounded display-language control', () => {
    expect(inboundMessageSchema.parse({ type: 'configureLanguage' })).toEqual({
      type: 'configureLanguage',
    });
  });

  it('accepts every selectable connection lane and rejects an unknown one', () => {
    const custom = {
      type: 'configureConnections',
      backendEnvironment: 'CUSTOM',
      backendCustomUrl: 'https://api.example.com',
      frontendEnvironment: 'CUSTOM',
      frontendCustomUrl: 'https://app.example.com',
    };
    expect(inboundMessageSchema.safeParse(custom).success).toBe(true);
    for (const environment of ['LOCAL', 'CLOUD', 'CUSTOM']) {
      expect(
        inboundMessageSchema.safeParse({
          ...custom,
          backendEnvironment: environment,
          frontendEnvironment: environment,
        }).success,
        `${environment} must be a selectable lane`,
      ).toBe(true);
    }
    expect(
      inboundMessageSchema.safeParse({
        ...custom,
        backendEnvironment: 'STAGING',
      }).success,
    ).toBe(false);
  });

  it('accepts every effort mode the composer offers and refuses an invented one', () => {
    for (const mode of ['LOW', 'MEDIUM', 'HIGH', 'MAX', 'XHIGH', 'ULTRA']) {
      expect(inboundMessageSchema.parse({ type: 'selectEffortMode', mode }), mode).toEqual({
        type: 'selectEffortMode',
        mode,
      });
    }
    for (const mode of ['EXTREME', 'low', '', 9]) {
      expect(
        inboundMessageSchema.safeParse({ type: 'selectEffortMode', mode }).success,
        String(mode),
      ).toBe(false);
    }
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
