import { describe, expect, it } from 'vitest';

import { rewindThread } from '../../src/backend/thread-client';
import { checkpointSchema } from '../../src/core/checkpoint';
import {
  checkpointAt,
  chronological,
  messagePreview,
  newestAnchor,
  parseRewindRequest,
  REWIND_PREVIEW_LENGTH,
} from '../../src/core/conversation-rewind';
import { inboundMessageSchema } from '../../src/webview/chat-inbound-message';

import type { Checkpoint } from '../../src/core/checkpoint.types';
import type { z } from 'zod';

const messages = [
  { id: 'm2', role: 'ASSISTANT', content: 'b', createdAt: '2026-09-29T10:00:02.000Z' },
  { id: 'm1', role: 'USER', content: 'a', createdAt: '2026-09-29T10:00:01.000Z' },
  { id: 'm3', role: 'USER', content: 'c', createdAt: new Date('2026-09-29T10:00:03.000Z') },
];

function checkpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return { id: 'c1', label: 'before', createdAt: 1, files: [], ...overrides };
}

describe('conversation rewind helpers', () => {
  it('orders messages oldest first whatever order the page came in', () => {
    expect(chronological(messages).map((message) => message.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('treats a missing or unreadable time as the start', () => {
    const undated = [
      { id: 'late', role: 'USER', content: '', createdAt: '2026-09-29T10:00:00.000Z' },
      { id: 'none', role: 'USER', content: '' },
      { id: 'bad', role: 'USER', content: '', createdAt: 'not a date' },
    ];
    expect(chronological(undated).at(-1)?.id).toBe('late');
  });

  it('anchors a checkpoint at the newest message, or nowhere for an empty thread', () => {
    expect(newestAnchor('t1', messages)).toEqual({ threadId: 't1', messageId: 'm3' });
    expect(newestAnchor('t1', [])).toBeUndefined();
  });

  it('finds only a checkpoint taken at exactly this thread and message', () => {
    const anchored = checkpoint({ conversation: { threadId: 't1', messageId: 'm2' } });
    const list = [checkpoint(), anchored];

    expect(checkpointAt(list, { threadId: 't1', messageId: 'm2' })).toBe(anchored);
    expect(checkpointAt(list, { threadId: 't1', messageId: 'm3' })).toBeUndefined();
    expect(checkpointAt(list, { threadId: 't2', messageId: 'm2' })).toBeUndefined();
  });

  it('shortens a preview to one bounded line', () => {
    expect(messagePreview('  fix\n\n the  parser ')).toBe('fix the parser');
    const long = messagePreview('x'.repeat(200));
    expect(long).toHaveLength(REWIND_PREVIEW_LENGTH);
    expect(long.endsWith('…')).toBe(true);
  });

  it('parses a panel request and falls back to the palette on anything malformed', () => {
    expect(parseRewindRequest({ sessionId: 's1', messageId: 'm1' })).toEqual({
      sessionId: 's1',
      messageId: 'm1',
    });
    expect(parseRewindRequest(undefined)).toEqual({});
    expect(parseRewindRequest({ messageId: '' })).toEqual({});
    expect(parseRewindRequest({ messageId: 'm1', extra: true })).toEqual({});
  });

  it('keeps an anchored checkpoint and still reads an old one without an anchor', () => {
    const anchored = checkpoint({ conversation: { threadId: 't1', messageId: 'm1' } });
    expect(checkpointSchema.parse(anchored)).toEqual(anchored);
    expect(checkpointSchema.parse(checkpoint())).toEqual(checkpoint());
    expect(
      checkpointSchema.safeParse(checkpoint({ conversation: { threadId: '', messageId: 'm' } }))
        .success,
    ).toBe(false);
  });

  it('accepts the panel rewind message only with a bounded message id', () => {
    expect(inboundMessageSchema.parse({ type: 'rewindToMessage', messageId: 'm1' })).toEqual({
      type: 'rewindToMessage',
      messageId: 'm1',
    });
    expect(inboundMessageSchema.safeParse({ type: 'rewindToMessage', messageId: '' }).success).toBe(
      false,
    );
  });
});

type PostRequester = <T>(
  path: string,
  schema: z.ZodType<T>,
  options: { method: 'POST'; body: unknown },
) => Promise<T>;

describe('rewindThread', () => {
  it('posts the pivot to the escaped thread rewind route and returns the count', async () => {
    const calls: unknown[] = [];
    const request: PostRequester = (path, schema, options) => {
      calls.push({ path, options });
      return Promise.resolve(
        schema.parse({ threadId: 'a/b', afterMessageId: 'm1', removedCount: 2 }),
      );
    };

    const result = await rewindThread(request, 'a/b', 'm1');

    expect(result.removedCount).toBe(2);
    expect(calls[0]).toEqual({
      path: '/chat-threads/a%2Fb/rewind',
      options: { method: 'POST', body: { afterMessageId: 'm1' } },
    });
  });

  it('refuses a reply without a count rather than reporting a rewind', async () => {
    const request: PostRequester = (_path, schema) =>
      Promise.resolve(schema.parse({ threadId: 't', afterMessageId: 'm' }));

    await expect(rewindThread(request, 't', 'm')).rejects.toThrow();
  });
});
