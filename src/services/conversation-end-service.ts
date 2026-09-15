import type { RunJournalService } from './run-journal-service';
import type { ConversationEndInput, PendingInterruptions } from '../core/conversation-end';
import type { ExtensionState } from '../core/extension-state';
import type { RunGoal } from '../core/run-goal.types';
import type { ConversationEndPort } from '../infrastructure/end-conversation-tool-executor';

interface ConversationEndCollaborators {
  readonly state: ExtensionState;
  /** The run's declared acceptance checks, when it declared any. */
  readonly goal: () => RunGoal | undefined;
  readonly journals: RunJournalService;
  readonly activeRunId: () => string | undefined;
}

/**
 * Reads what the user still owes an answer to, and writes the terminal record.
 *
 * The pending state is read from the published snapshot rather than from the
 * broker, because the broker publishes a placeholder approval alongside every
 * question — checking the snapshot in that order is what stops a question
 * being reported to the model as an approval.
 *
 * A run with no journal records nothing and says so. Inventing a journal at
 * the end would mean fabricating the policy and capability hashes that make
 * one worth trusting.
 */
export function conversationEndPort(parts: ConversationEndCollaborators): ConversationEndPort {
  return {
    pending: (): PendingInterruptions => {
      const snapshot = parts.state.snapshot;
      if (snapshot.questionRequest !== undefined) {
        return { approvalTitle: undefined, questionHeader: snapshot.questionRequest.header };
      }
      return { approvalTitle: snapshot.approvalRequest?.title, questionHeader: undefined };
    },
    goal: () => parts.goal(),
    finish: async (input: ConversationEndInput): Promise<void> => {
      const runId = parts.activeRunId();
      if (runId === undefined) return;
      const journal = await parts.journals.load(runId);
      if (journal === undefined) return;
      await parts.journals.save({
        ...journal,
        lifecycle: input.lifecycle,
        terminalReason: input.reason,
        updatedAt: new Date().toISOString(),
      });
    },
  };
}
