import type { ApprovalBroker } from '../core/approval-broker';

export interface CoordinatorInterruptions {
  /** Settle the approval on screen. `false` also withdraws a question as dismissed. */
  resolveApproval(id: string, approved: boolean): void;
  /** Record an answer to the question on screen, if the selection is one it offered. */
  answerQuestion(id: string, choice: unknown): void;
}

/**
 * The two ways the user replies to whatever the run is waiting on.
 *
 * They live beside the coordinator rather than on it for the same reason the
 * boundaries, runtime and workflow actions do: the class sits on a 500-line
 * ceiling, and a pair of delegations is not worth spending it on. Grouping them
 * also keeps the fact visible that there is one queue behind both — an approval
 * and a question share a modal slot, and rejecting either takes the same path.
 */
export function coordinatorInterruptions(
  approvals: () => ApprovalBroker,
): CoordinatorInterruptions {
  return {
    resolveApproval: (id, approved) => void approvals().resolve(id, approved),
    answerQuestion: (id, choice) => void approvals().answer(id, choice),
  };
}
