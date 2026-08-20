import { isEmptyProviderResponse } from './agent-run-guards';

import type {
  AgentRunCallbacks,
  AgentRunChatPort,
  AgentRunInput,
  AgentRunSessionPort,
} from './agent-run-service.types';
import type { CollectedContext } from '../core/context-collector';

export async function sendWithEmptyProviderRetry<T>(
  send: () => Promise<T>,
  signal: AbortSignal,
  onRetry: () => void,
): Promise<T> {
  try {
    return await send();
  } catch (error: unknown) {
    signal.throwIfAborted();
    if (!isEmptyProviderResponse(error)) throw error;
    onRetry();
    return send();
  }
}

export function sendAgentRunChat(input: {
  chat: AgentRunChatPort;
  run: AgentRunInput;
  content: string;
  callbacks: AgentRunCallbacks;
  session: AgentRunSessionPort;
  fileIds: string[] | undefined;
  threadId?: string;
  context?: CollectedContext;
}): ReturnType<AgentRunChatPort['send']> {
  const request = {
    content: input.session.preparePrompt(input.content),
    clientIntent: input.run.content,
    context: input.context?.files ?? [],
    ...(input.context === undefined ? {} : { contextReceipt: input.context.receipt }),
    ...input.run.selection,
    ...(input.run.researchMode === undefined ? {} : { researchMode: input.run.researchMode }),
    ...(input.fileIds === undefined ? {} : { fileIds: input.fileIds }),
    ...((input.threadId ?? input.run.threadId) === undefined
      ? {}
      : { threadId: input.threadId ?? input.run.threadId }),
  };
  const send = () =>
    input.chat.send(
      request,
      (event) => {
        input.callbacks.onEvent(event);
      },
      input.run.signal,
      (threadId) => {
        input.callbacks.onThread(threadId);
      },
      input.run.onAccepted,
    );
  return sendWithEmptyProviderRetry(send, input.run.signal, () => {
    input.callbacks.onEvent({ type: 'AGENT_DRAFT_RESET' });
  });
}
