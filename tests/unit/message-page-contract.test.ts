import { describe, expect, it } from 'vitest';

import { messagePageSchema } from '../../src/backend/contracts';
import { listMessages } from '../../src/backend/thread-client';

import type { z } from 'zod';

const message = { id: 'm1', threadId: 't1', role: 'USER', content: 'hi' };

/** What GET /chat-messages/thread/:id answers since the backend moved to cursor pagination. */
const cursorPage = { data: [message], meta: { total: 14, limit: 5, nextBefore: 'm0' } };
const lastCursorPage = { data: [message], meta: { total: 1, limit: 100, nextBefore: null } };
const legacyPage = { data: [message], meta: { total: 1, page: 1, limit: 100, totalPages: 1 } };

describe('message page contract', () => {
  it.each([
    ['cursor page', cursorPage],
    ['last cursor page', lastCursorPage],
    ['legacy offset page', legacyPage],
  ])('parses a %s', (_name, body) => {
    expect(messagePageSchema.parse(body).data).toHaveLength(1);
  });

  it('still refuses a body with no data array', () => {
    expect(() => messagePageSchema.parse({ meta: { total: 0, limit: 1 } })).toThrow();
  });

  it('listMessages reads a cursor page instead of failing the whole history load', async () => {
    const request = async <T>(_path: string, schema: z.ZodType<T>): Promise<T> =>
      schema.parse(cursorPage);
    await expect(listMessages(request, 't1', 100)).resolves.toEqual([message]);
  });
});
