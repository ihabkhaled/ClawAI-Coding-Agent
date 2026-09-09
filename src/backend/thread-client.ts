import {
  messageSchema,
  paginatedSchema,
  threadSchema,
  type ChatMessage,
  type ChatThread,
} from './contracts';

import type { z } from 'zod';

type PatchRequester = <T>(
  path: string,
  schema: z.ZodType<T>,
  options: { method: 'PATCH'; body: unknown },
) => Promise<T>;

/** The fields a chat thread can be renamed, archived or pinned with. */
export interface ThreadPatch {
  readonly title?: string;
  readonly isArchived?: boolean;
  readonly isPinned?: boolean;
}

/**
 * Renames, archives or pins one thread.
 *
 * `PATCH /chat-threads/:id` has accepted `title`, `isArchived` and `isPinned`
 * since before this client existed — the extension simply never called it, so
 * a conversation could be named only by whatever its first message derived and
 * could never be put away. Nothing new was needed on the server.
 *
 * Failures are not swallowed. A rename that did not happen must not look like
 * one that did, because the next thing the user sees is a list that still says
 * the old name and no reason why.
 */
export async function updateThread(
  request: PatchRequester,
  threadId: string,
  patch: ThreadPatch,
): Promise<ChatThread> {
  return request(`/chat-threads/${encodeURIComponent(threadId)}`, threadSchema, {
    method: 'PATCH',
    body: patch,
  });
}

type GetRequester = <T>(path: string, schema: z.ZodType<T>) => Promise<T>;

type PostRequester = <T>(
  path: string,
  schema: z.ZodType<T>,
  options: { method: 'POST'; body: unknown },
) => Promise<T>;

/** What a new thread is opened with. */
export interface ThreadCreateInput {
  title?: string;
  routingMode: 'AUTO' | 'MANUAL_MODEL';
  preferredProvider?: string;
  preferredModel?: string;
}

export async function createThread(
  request: PostRequester,
  input: ThreadCreateInput,
): Promise<ChatThread> {
  return request('/chat-threads', threadSchema, { body: input, method: 'POST' });
}

/**
 * Every thread the account has, archived ones included.
 *
 * Filtering happens on the client rather than through the `isArchived` query
 * the endpoint offers, because the archived browser needs the same list. One
 * request that both views read cannot disagree with itself; two requests can.
 */
export async function listThreads(request: GetRequester, limit: number): Promise<ChatThread[]> {
  const result = await request(
    `/chat-threads?limit=${String(limit)}`,
    paginatedSchema(threadSchema),
  );
  return result.data;
}

export async function listMessages(
  request: GetRequester,
  threadId: string,
  limit: number,
): Promise<ChatMessage[]> {
  const result = await request(
    `/chat-messages/thread/${encodeURIComponent(threadId)}?limit=${String(limit)}`,
    paginatedSchema(messageSchema),
  );
  return result.data;
}
