import { describe, expect, it } from 'vitest';

import { messageSchema } from '../../src/backend/contracts';

describe('backend contracts', () => {
  it('rejects unbounded persisted model labels in chat history', () => {
    expect(
      messageSchema.safeParse({
        content: 'Hello',
        id: 'message-1',
        metadata: { modelDisplayName: 'm'.repeat(256) },
        role: 'USER',
        threadId: 'thread-1',
      }).success,
    ).toBe(false);
  });
});
