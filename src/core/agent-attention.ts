import type { AgentAttentionItem } from './agent-attention.types';
import type { AgentRunSnapshot } from './agent-run';
import type { ApprovalRequest } from './approval-broker';
import type { GenerationQueueSnapshot } from './generation-queue';
import type { UserQuestion } from './user-question';

/**
 * How long an active run may go before it is worth listing.
 *
 * Not a timeout and not a failure: a run that has read a large repository for
 * six minutes is working. The point is that a reader who walked away cannot
 * otherwise tell that apart from a run that will never finish, and the queue is
 * where that question gets answered.
 */
export const SLOW_RUN_MS = 5 * 60 * 1000;

export interface AgentAttentionInput {
  approvalRequest: ApprovalRequest | undefined;
  questionRequest: UserQuestion | undefined;
  agentRuns: Record<string, AgentRunSnapshot>;
  generationQueue: GenerationQueueSnapshot;
}

/** The phases that mean the run is over and did not do what was asked. */
const UNHAPPY_PHASES = new Set(['failed', 'rejected']);

function blockedItems(input: AgentAttentionInput): AgentAttentionItem[] {
  const items: AgentAttentionItem[] = [];
  const approval = input.approvalRequest;
  if (approval !== undefined) {
    items.push({ reason: 'approval', id: approval.id, title: approval.title });
  }
  const question = input.questionRequest;
  if (question !== undefined) {
    items.push({ reason: 'question', id: question.id, title: question.question });
  }
  return items;
}

function failedItems(input: AgentAttentionInput): AgentAttentionItem[] {
  return Object.entries(input.agentRuns)
    .filter(([, run]) => UNHAPPY_PHASES.has(run.phase))
    .map(([requestId, run]) => ({
      reason: 'failed' as const,
      id: requestId,
      title: run.summary ?? run.phase,
    }));
}

function runningItems(input: AgentAttentionInput, now: number): AgentAttentionItem[] {
  const slow = input.generationQueue.active
    .filter((entry) => now - entry.startedAt >= SLOW_RUN_MS)
    .map((entry) => ({
      reason: 'slow' as const,
      id: entry.id,
      title: entry.prompt,
      waitingMs: Math.max(0, now - entry.startedAt),
    }));
  const queued = input.generationQueue.pending.map((entry) => ({
    reason: 'queued' as const,
    id: entry.id,
    title: entry.prompt,
  }));
  return [...slow, ...queued];
}

/**
 * What is waiting for the reader, worst first.
 *
 * A headless or unattended run stalls on an approval nobody clicked, and there
 * has never been a place that says so: the request lives in the panel, and a
 * reader looking at any other editor has no signal at all. Ordering is the
 * whole point — an approval blocks a run forever, a failure has already
 * happened, and a queued run is merely waiting its turn. Listing them in any
 * other order would bury the one that costs something.
 */
export function agentAttentionQueue(input: AgentAttentionInput, now: number): AgentAttentionItem[] {
  return [...blockedItems(input), ...failedItems(input), ...runningItems(input, now)];
}

/**
 * The number a view badge should show: only what has actually stopped and needs
 * a person. Counting queued work would leave a badge lit through every ordinary
 * busy period, and a badge that is always on says nothing.
 */
export function attentionBadgeCount(items: readonly AgentAttentionItem[]): number {
  return items.filter(
    (item) => item.reason === 'approval' || item.reason === 'question' || item.reason === 'failed',
  ).length;
}
