import type { BackendClient } from '../backend/backend-client';
import type { AdvisorSelection } from '../core/advisor.types';
import type { ExtensionState } from '../core/extension-state';
import type { AdvisorPort } from '../infrastructure/advisor-tool-executor.types';

/**
 * The advisor's one call, bound to whichever backend client is current.
 *
 * A getter rather than an instance, for the same reason the web tool uses one:
 * the client is replaced when the user changes endpoints or signs in again, and
 * a tool holding the old one would go on talking to the account they left.
 *
 * Each consultation gets a thread of its own, pinned to the advisor's provider
 * and model. Sending it into the run's conversation would put a second model's
 * words into the transcript the user is reading as their own agent's, and
 * reusing one advisor thread across consultations would let one question's
 * answer colour the next.
 */
export function backendAdvisor(backend: () => BackendClient, state: ExtensionState): AdvisorPort {
  return {
    catalog: () => state.snapshot.models,
    runningModelKey: () =>
      state.snapshot.routingMode === 'MANUAL_MODEL' ? state.snapshot.selectedModel : '',
    consult: async (advisor: AdvisorSelection, prompt: string, signal?: AbortSignal) => {
      const client = backend();
      const thread = await client.createThread({
        title: `Advice: ${advisor.displayName}`,
        routingMode: 'MANUAL_MODEL',
        preferredProvider: advisor.provider,
        preferredModel: advisor.model,
      });
      const reply = await client.sendMessage(
        {
          threadId: thread.id,
          content: prompt,
          routingMode: 'MANUAL_MODEL',
          provider: advisor.provider,
          model: advisor.model,
        },
        signal,
      );
      return reply.content;
    },
  };
}
