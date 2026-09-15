import { describe, expect, it } from 'vitest';

import { updateThread } from '../../src/backend/thread-client';

import type { z } from 'zod';

type PatchRequester = <T>(
  path: string,
  schema: z.ZodType<T>,
  options: { method: 'PATCH'; body: unknown },
) => Promise<T>;

function requester(reply: unknown): { request: PatchRequester; calls: unknown[] } {
  const calls: unknown[] = [];
  const request: PatchRequester = (path, schema, options) => {
    calls.push({ path, options });
    return Promise.resolve(schema.parse(reply));
  };
  return { request, calls };
}

describe('updateThread', () => {
  it('patches the thread the contract already accepted', async () => {
    const { request, calls } = requester({ id: 'thread-1', title: 'Parser rewrite' });

    const thread = await updateThread(request, 'thread-1', { title: 'Parser rewrite' });

    expect(thread.title).toBe('Parser rewrite');
    expect(calls[0]).toMatchObject({
      path: '/chat-threads/thread-1',
      options: { method: 'PATCH', body: { title: 'Parser rewrite' } },
    });
  });

  it('escapes a thread id rather than pasting it into the path', async () => {
    const { request, calls } = requester({ id: 'a/b' });

    await updateThread(request, 'a/b', { isArchived: true });

    expect(calls[0]).toMatchObject({ path: '/chat-threads/a%2Fb' });
  });

  it('carries the archived flag back so a caller sees what landed', async () => {
    const { request } = requester({ id: 'thread-1', isArchived: true });

    expect((await updateThread(request, 'thread-1', { isArchived: true })).isArchived).toBe(true);
  });

  it('does not swallow a failure, because a rename that did not happen must not look like one that did', async () => {
    const failing: PatchRequester = () => Promise.reject(new Error('403'));

    await expect(updateThread(failing, 'thread-1', { title: 'x' })).rejects.toThrow('403');
  });
});
