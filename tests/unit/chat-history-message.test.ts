import { describe, expect, it } from 'vitest';

import { publicHistoryMessage } from '../../src/webview/chat-history-message';

describe('publicHistoryMessage', () => {
  it('forwards the persisted model label without exposing unrelated metadata', () => {
    expect(
      publicHistoryMessage({
        id: 'message-1',
        threadId: 'thread-1',
        role: 'USER',
        content: 'Inspect the workspace',
        metadata: {
          modelDisplayName: 'Kimi K2.7 Code',
          privateValue: 'do-not-forward',
        },
      }),
    ).toEqual({
      content: 'Inspect the workspace',
      createdAt: undefined,
      id: 'message-1',
      inputTokens: undefined,
      latencyMs: undefined,
      model: undefined,
      modelDisplayName: 'Kimi K2.7 Code',
      outputTokens: undefined,
      provider: undefined,
      role: 'USER',
      status: undefined,
    });
  });
});
