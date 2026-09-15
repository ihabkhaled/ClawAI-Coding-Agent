import { describe, expect, it, vi } from 'vitest';

import { submitFeedback } from '../../src/backend/feedback-client';

import type { z } from 'zod';

type PostRequester = <T>(
  path: string,
  schema: z.ZodType<T>,
  options: { method: 'POST'; body: unknown; signal?: AbortSignal },
) => Promise<T>;

function requester(ticket: unknown): { request: PostRequester; calls: unknown[] } {
  const calls: unknown[] = [];
  const request: PostRequester = (path, schema, options) => {
    calls.push({ path, options });
    return Promise.resolve(schema.parse(ticket));
  };
  return { request, calls };
}

const accepted = { id: 'ticket-1', ticketNumber: 'FB-1042', status: 'OPEN' };

describe('submitFeedback', () => {
  it('posts the reviewed report to the audit service contract', async () => {
    const { request, calls } = requester(accepted);

    const ticket = await submitFeedback(request, {
      type: 'BUG_REPORT',
      title: 'Undo leaves a file half written',
      contentMarkdown: '# Undo leaves a file half written\n\n## ClawAI diagnostic report',
    });

    expect(ticket).toMatchObject({ ticketNumber: 'FB-1042' });
    expect(calls[0]).toMatchObject({
      path: '/feedback',
      options: {
        method: 'POST',
        body: {
          type: 'BUG_REPORT',
          title: 'Undo leaves a file half written',
          contentMarkdown: expect.stringContaining('diagnostic report'),
        },
      },
    });
  });

  it('accepts a ticket carrying fields this client does not know about', async () => {
    const { request } = requester({ ...accepted, assignee: 'someone', priority: 3 });

    await expect(
      submitFeedback(request, { type: 'OTHER', title: 'Hello', contentMarkdown: 'Body' }),
    ).resolves.toMatchObject({ ticketNumber: 'FB-1042' });
  });

  it('rejects a response that is not a ticket rather than reporting a send', async () => {
    const { request } = requester({ ticketNumber: 'FB-1042' });

    await expect(
      submitFeedback(request, { type: 'OTHER', title: 'Hello', contentMarkdown: 'Body' }),
    ).rejects.toThrow();
  });

  it('propagates a transport failure instead of failing open', async () => {
    const request = vi.fn(() => Promise.reject(new Error('offline'))) as unknown as PostRequester;

    await expect(
      submitFeedback(request, { type: 'OTHER', title: 'Hello', contentMarkdown: 'Body' }),
    ).rejects.toThrow('offline');
  });
});
