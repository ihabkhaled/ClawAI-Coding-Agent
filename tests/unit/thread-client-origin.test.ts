import { describe, expect, it } from 'vitest';

import { createThread, listThreads } from '../../src/backend/thread-client';
import { THREAD_ORIGIN } from '../../src/backend/thread-client.constants';

import type { z } from 'zod';

type PostRequester = <T>(
  path: string,
  schema: z.ZodType<T>,
  options: { method: 'POST'; body: unknown },
) => Promise<T>;

type GetRequester = <T>(path: string, schema: z.ZodType<T>) => Promise<T>;

function poster(reply: unknown): { request: PostRequester; calls: unknown[] } {
  const calls: unknown[] = [];
  const request: PostRequester = (path, schema, options) => {
    calls.push({ path, options });
    return Promise.resolve(schema.parse(reply));
  };
  return { request, calls };
}

function getter(reply: unknown): { request: GetRequester; paths: string[] } {
  const paths: string[] = [];
  const request: GetRequester = (path, schema) => {
    paths.push(path);
    return Promise.resolve(schema.parse(reply));
  };
  return { request, paths };
}

/**
 * Which conversations belong to this extension, and which do not.
 *
 * The agent talks to the same chat API as the web app and as the same user.
 * Without the origin on the way in and on the way out, every run appeared in
 * the user's own chat list and the extension listed their web conversations
 * back to them.
 */
describe('thread origin', () => {
  it('tags a created thread as a coding agent thread', async () => {
    const { request, calls } = poster({ id: 'thread-1' });

    await createThread(request, { routingMode: 'AUTO' });

    expect(calls[0]).toMatchObject({
      path: '/chat-threads',
      options: { body: { origin: THREAD_ORIGIN, routingMode: 'AUTO' } },
    });
  });

  it('keeps what the caller asked for alongside the origin', async () => {
    const { request, calls } = poster({ id: 'thread-1' });

    await createThread(request, { routingMode: 'AUTO', title: 'Parser rewrite' });

    expect(calls[0]).toMatchObject({ options: { body: { title: 'Parser rewrite' } } });
  });

  it('asks the backend for coding agent threads rather than filtering afterwards', async () => {
    // The endpoint defaults to WEB, so a request that said nothing about
    // origin would return the user's own conversations and none of the runs.
    const { request, paths } = getter({
      data: [],
      meta: { total: 0, page: 1, limit: 25, totalPages: 0 },
    });

    await listThreads(request, 25);

    expect(paths[0]).toContain(`origin=${THREAD_ORIGIN}`);
    expect(paths[0]).toContain('limit=25');
  });
});
