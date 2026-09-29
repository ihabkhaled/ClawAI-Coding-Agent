import { threadOriginForSource } from '../core/thread-source';

import { paginatedSchema, threadSchema, type ChatThread } from './contracts';
import {
  cloudTaskSchema,
  runnerRepoPageSchema,
  runnerSessionPageSchema,
  type CloudTask,
  type RunnerRepo,
  type RunnerSession,
} from './remote-session-contracts';

import type { ThreadSource } from '../core/thread-source.types';
import type { z } from 'zod';

/** The authenticated request seam; `BackendClient.remoteRequest` provides it. */
export type RemoteRequester = <T>(
  path: string,
  schema: z.ZodType<T>,
  options?: { method: 'GET' | 'POST'; body?: unknown },
) => Promise<T>;

/**
 * Reads and writes for work that did not start in this window: threads opened
 * on another surface (F094/F095) and sessions on a registered runner (F098).
 * Every endpoint here already exists; this module is the client half.
 */
export const remoteSessionClient = {
  /** Threads a given surface created. `web` lists the portal's own conversations. */
  async threadsFrom(
    request: RemoteRequester,
    source: ThreadSource,
    limit: number,
  ): Promise<ChatThread[]> {
    const origin = threadOriginForSource(source);
    const result = await request(
      `/chat-threads?limit=${String(limit)}&origin=${origin}`,
      paginatedSchema(threadSchema),
    );
    return result.data;
  },

  /** Runners that are connected now. A disconnected one cannot take work. */
  async connectedRunners(request: RemoteRequester): Promise<RunnerSession[]> {
    const page = await request(
      '/agent/sessions?status=CONNECTED&pageSize=50',
      runnerSessionPageSchema,
    );
    return page.data;
  },

  async runnerRepos(request: RemoteRequester, sessionId: string): Promise<RunnerRepo[]> {
    const page = await request(
      `/agent/repos?sessionId=${encodeURIComponent(sessionId)}&pageSize=100`,
      runnerRepoPageSchema,
    );
    return page.data;
  },

  async dispatch(
    request: RemoteRequester,
    input: { readonly sessionId: string; readonly workingDir: string; readonly command: string },
  ): Promise<CloudTask> {
    return request('/agent/commands', cloudTaskSchema, { method: 'POST', body: input });
  },

  async task(request: RemoteRequester, taskId: string): Promise<CloudTask> {
    return request(`/agent/commands/${encodeURIComponent(taskId)}`, cloudTaskSchema);
  },
};
