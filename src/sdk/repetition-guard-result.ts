import { headlessExitCode } from '../core/headless-outcome';

import {
  STUCK_CONTINUATION_LINE,
  STUCK_ERROR_PREFIX,
  STUCK_PROMPT_TAIL,
} from './repetition-guard.constants';

import type { AgentEvent } from './create-agent.types';
import type { StuckInfo } from './repetition-guard.types';
import type { RunBudgetTrip } from './run-budget.types';
import type { HeadlessOutcome } from '../core/headless-outcome.types';

const describeWhat = (stuck: StuckInfo): string =>
  `${stuck.tool} ${stuck.operation}${stuck.target.length === 0 ? '' : ` on ${stuck.target}`}`;

/** The event that says the run was ended for repeating itself; the target stays out of it. */
export function stuckEvent(stuck: StuckInfo): AgentEvent {
  return { type: 'run.stuck', tool: stuck.tool, operation: stuck.operation, times: stuck.times };
}

/** `result.error` for a stuck run. */
export function describeStuck(stuck: StuckInfo): string {
  return `${STUCK_ERROR_PREFIX}: the run made the same ${describeWhat(stuck)} call ${String(stuck.times)} times and nothing changed, so it was stopped.`;
}

/** What a continuation run is told after a stuck one. */
export function stuckPrompt(stuck: StuckInfo): string {
  const line = STUCK_CONTINUATION_LINE.replace('{what}', describeWhat(stuck));
  return `${line} ${STUCK_PROMPT_TAIL}`;
}

/**
 * The outcome of a run that may have been stopped by a guard.
 *
 * A budget guard wins: it is the caller's own limit. A stuck run is `failed`
 * (exit 1) rather than a new outcome, so pipelines that already handle the
 * seven codes keep working; `result.stuck` says why.
 */
export function guardedOutcome(
  reported: HeadlessOutcome,
  guards: { trip: RunBudgetTrip | undefined; stuck: StuckInfo | undefined },
): HeadlessOutcome {
  if (guards.trip !== undefined) return 'exhausted';
  return guards.stuck === undefined ? reported : 'failed';
}

/** The result fields for a stuck run: exit code, reason and the call that looped. */
export function stuckFields(stuck: StuckInfo | undefined): {
  stuck?: StuckInfo;
  error?: string;
  exitCode?: ReturnType<typeof headlessExitCode>;
} {
  return stuck === undefined
    ? {}
    : { stuck, error: describeStuck(stuck), exitCode: headlessExitCode('failed') };
}
