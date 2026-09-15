import type { DurableRunJournal, ResumeValidation } from './durable-run-journal';
import type { Finding } from './findings';

export const RECAP_NEXT_ACTIONS = [
  'nothing',
  'resume',
  'approve-then-resume',
  'replan',
  'review-findings',
  'investigate-failure',
] as const;

export type RecapNextAction = (typeof RECAP_NEXT_ACTIONS)[number];

export interface SessionRecap {
  readonly goal: string;
  readonly lifecycle: DurableRunJournal['lifecycle'];
  readonly filesChanged: number;
  readonly toolCalls: number;
  /** Invocations that failed, and ones left mid-flight by a restart. */
  readonly failedInvocations: number;
  readonly unfinishedInvocations: number;
  readonly blockingFindings: number;
  /** Why the run cannot simply continue, in the resume validator's own words. */
  readonly blockers: readonly string[];
  readonly nextAction: RecapNextAction;
}

function blockingFindingCount(findings: readonly Finding[]): number {
  return findings.filter(
    (finding) =>
      (finding.severity === 'critical' || finding.severity === 'high') &&
      finding.confidence !== 'low',
  ).length;
}

/**
 * Decides the one thing worth doing next.
 *
 * Ordered by what would be wasted by ignoring it. A drifted workspace has to be
 * replanned before anything else is worth attempting; a stale approval has to
 * be re-granted before a resume can proceed; a failure is worth understanding
 * before it is repeated; findings are worth reading before more code lands on
 * top of them.
 */
function nextAction(recap: Omit<SessionRecap, 'nextAction'>): RecapNextAction {
  if (['completed', 'cancelled', 'abandoned'].includes(recap.lifecycle)) {
    return recap.blockingFindings > 0 ? 'review-findings' : 'nothing';
  }
  if (recap.blockers.includes('workspace') || recap.blockers.includes('files')) return 'replan';
  if (recap.blockers.includes('account') || recap.blockers.includes('policy')) {
    return 'approve-then-resume';
  }
  if (recap.failedInvocations > 0) return 'investigate-failure';
  if (recap.blockingFindings > 0) return 'review-findings';
  return 'resume';
}

/**
 * What happened in a run, for someone who has just come back to it.
 *
 * Returning to a session replayed the raw messages and nothing else, so the
 * only way to learn that three files changed, an approval had gone stale and
 * the last tool call failed was to read the whole transcript and infer it. Each
 * of those facts is already recorded; none of them was ever summarised.
 *
 * An invocation left `executing` is counted separately from one that `failed`.
 * They mean different things to a reader: a failure happened and is known, and
 * an unfinished one may or may not have taken effect before the host stopped.
 */
export function summarizeRun(
  journal: DurableRunJournal,
  resume?: ResumeValidation,
  findings: readonly Finding[] = [],
): SessionRecap {
  const base = {
    goal: journal.goal,
    lifecycle: journal.lifecycle,
    filesChanged: journal.fileTransactionIds.length,
    toolCalls: journal.invocations.length,
    failedInvocations: journal.invocations.filter(({ effectState }) => effectState === 'failed')
      .length,
    unfinishedInvocations: journal.invocations.filter(
      ({ effectState }) => effectState === 'executing' || effectState === 'prepared',
    ).length,
    blockingFindings: blockingFindingCount(findings),
    blockers: resume?.reasons ?? [],
  };
  return { ...base, nextAction: nextAction(base) };
}
