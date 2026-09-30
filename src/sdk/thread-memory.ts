import { RuntimeHttpError } from '../headless/runtime-http-error';

import { AGENT_SDK_DEFAULTS } from './agent-sdk.constants';
import { MEMORY_REFUSAL_STATUSES } from './thread-memory.constants';

import type { AgentMemoryMode, AgentRunOptions, RuntimeTransportPort } from './agent-sdk.types';

/**
 * The thread a run uses: the one given, or a new one.
 *
 * Only a thread made here is touched (`memory` is set); a continued thread keeps
 * its own settings and `memory` is left out.
 */
export async function openThread(
  transport: RuntimeTransportPort,
  token: string,
  options: Pick<AgentRunOptions, 'threadId' | 'title' | 'useMemory' | 'onMemoryUnchanged'>,
): Promise<{ threadId: string; memory?: AgentMemoryMode }> {
  if (options.threadId !== undefined) return { threadId: options.threadId };
  const threadId = await transport.createThread(token, options.title ?? AGENT_SDK_DEFAULTS.title);
  return { threadId, memory: await applyThreadMemory(transport, token, threadId, options) };
}

/**
 * Keeps a new thread from ingesting the account's stored personal memories.
 *
 * Best effort by design: an older or stricter backend that refuses the update
 * (400, 403, 404) is reported once and the run proceeds on the account default,
 * because a coding run that cannot start is worse than one that is less
 * deterministic. Any other failure, after the transport's own retries, is real
 * and propagates.
 */
export async function applyThreadMemory(
  transport: RuntimeTransportPort,
  token: string,
  threadId: string,
  options: Pick<AgentRunOptions, 'useMemory' | 'onMemoryUnchanged'>,
): Promise<AgentMemoryMode> {
  if (options.useMemory === true || transport.setThreadMemory === undefined) {
    return 'account-default';
  }
  try {
    await transport.setThreadMemory(token, threadId, false);
    return 'off';
  } catch (error) {
    if (error instanceof RuntimeHttpError && MEMORY_REFUSAL_STATUSES.includes(error.status)) {
      options.onMemoryUnchanged?.({ status: error.status });
      return 'account-default';
    }
    throw error;
  }
}
