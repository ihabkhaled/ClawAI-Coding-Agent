import { resolveModelSelection } from '../core/model-catalog';

import type { RunAgentInput } from './agent-coordinator.types';
import type { RuntimeConfiguration } from './configuration-service';
import type { BackendClient } from '../backend/backend-client';
import type { ModelCatalogEntry } from '../core/model-catalog';

/**
 * Asks the conversation's own model to summarize it.
 *
 * Sent into the thread being summarized, with the same routing the
 * conversation has been using. A different model would be summarizing a
 * conversation it never saw, and a side thread would hide from the user what
 * was written on their behalf. This is the last thing that happens in the old
 * conversation, and it is visible there.
 */
export async function summarizeThread(
  backend: BackendClient,
  configuration: RuntimeConfiguration,
  catalog: ModelCatalogEntry[],
  threadId: string,
  instruction: string,
): Promise<string> {
  const selection = resolveModelSelection(
    configuration.routingMode,
    configuration.routingMode === 'MANUAL_MODEL' ? configuration.selectedModel : 'AUTO',
    catalog,
  );
  const reply = await backend.sendMessage({
    threadId,
    content: instruction,
    routingMode: selection.routingMode,
    ...(selection.provider === undefined ? {} : { provider: selection.provider }),
    ...(selection.model === undefined ? {} : { model: selection.model }),
  });
  return reply.content;
}

/**
 * Opens a fresh conversation and sends the summary as its first message.
 *
 * A new conversation rather than a rewritten one: the original keeps every word
 * and stays in history. Compaction that destroyed the thing it compacted would
 * be a feature people are afraid to use.
 */
export async function continueInNewConversation(
  runAgent: (input: RunAgentInput) => Promise<void>,
  openChat: () => Promise<string | undefined>,
  seed: string,
): Promise<void> {
  const sessionId = await openChat();
  await runAgent({
    content: seed,
    contextMode: 'none',
    ...(sessionId === undefined ? {} : { sessionId }),
  });
}
