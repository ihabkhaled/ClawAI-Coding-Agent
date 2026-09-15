/**
 * Why a run is on the attention list.
 *
 * Ordered by what it costs to leave alone. `approval` and `question` are runs
 * that have stopped and will never restart on their own; `failed` is work that
 * has already ended badly and the reader has not seen; `queued` and `slow` are
 * runs still going, listed so a reader can tell a busy queue from a stuck one.
 */
export type AgentAttentionReason = 'approval' | 'question' | 'failed' | 'queued' | 'slow';

export interface AgentAttentionItem {
  readonly reason: AgentAttentionReason;
  /** The request this is about, or the approval or question's own id. */
  readonly id: string;
  readonly title: string;
  /** How long it has been waiting, in milliseconds, when that is knowable. */
  readonly waitingMs?: number;
}
