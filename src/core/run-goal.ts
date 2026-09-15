import {
  MAX_CHECK_LENGTH,
  MAX_GOAL_CHECKS,
  MAX_GOAL_STATEMENT_LENGTH,
  MIN_WAIVER_REASON_LENGTH,
} from './run-goal.constants';

import type {
  RunGoal,
  RunGoalCheck,
  RunGoalDeclareResult,
  RunGoalResolveResult,
} from './run-goal.types';

/**
 * Records what this run is for and how anyone will know it worked.
 *
 * An ordinary run had no completion condition. It ended when the model decided
 * it was finished, and "finished" was a sentence in a summary rather than
 * anything checkable. The flagship lane has had acceptance checks since it
 * existed; this is the same idea without the ten fixed stages around it.
 *
 * Redeclaring over an unsettled goal is refused, and that is the load-bearing
 * rule. A model that could replace its own checks could clear every one of them
 * by declaring a shorter list, which turns the whole mechanism into a formality
 * it satisfies by rewriting the test.
 */
export function declareGoal(
  existing: RunGoal | undefined,
  statement: string,
  checks: readonly string[],
): RunGoalDeclareResult {
  if (existing?.checks.some((check) => check.state === 'open') === true) {
    return {
      declared: false,
      refusal:
        'This run already has a goal with open checks. Resolve or waive them before declaring a new goal.',
    };
  }
  const trimmed = statement.trim().slice(0, MAX_GOAL_STATEMENT_LENGTH);
  if (trimmed.length === 0) return { declared: false, refusal: 'A goal needs a statement.' };
  const unique = [...new Set(checks.map((check) => check.trim()).filter((c) => c.length > 0))];
  if (unique.length === 0) {
    return {
      declared: false,
      refusal: 'A goal needs at least one acceptance check, or it cannot be held to anything.',
    };
  }
  if (unique.length > MAX_GOAL_CHECKS) {
    return {
      declared: false,
      refusal: `A goal takes at most ${String(MAX_GOAL_CHECKS)} checks. More than that is a plan, not a completion condition.`,
    };
  }
  return {
    declared: true,
    goal: {
      statement: trimmed,
      checks: unique.map((text, index) => ({
        id: `check-${String(index + 1)}`,
        text: text.slice(0, MAX_CHECK_LENGTH),
        state: 'open' as const,
      })),
    },
  };
}

/**
 * Settles one check, met or waived.
 *
 * Both need evidence, and a waiver needs more of it. "Met" without evidence is
 * the same claim the summary already makes, and a waiver without a reason is
 * how a run passes its own test by deleting it. The floor on a waiver's length
 * does not make the reason good — it makes an empty one visible.
 */
export function resolveCheck(
  goal: RunGoal | undefined,
  checkId: string,
  state: 'met' | 'waived',
  evidence: string,
): RunGoalResolveResult {
  if (goal === undefined) {
    return { resolved: false, refusal: 'This run has no goal to resolve a check against.' };
  }
  const target = goal.checks.find((check) => check.id === checkId);
  if (target === undefined) {
    return { resolved: false, refusal: `No such check: ${checkId}.` };
  }
  const reason = evidence.trim();
  if (reason.length === 0) {
    return { resolved: false, refusal: 'Say what settles this check.' };
  }
  if (state === 'waived' && reason.length < MIN_WAIVER_REASON_LENGTH) {
    return {
      resolved: false,
      refusal: 'Waiving a check needs a real reason for why it no longer applies.',
    };
  }
  const settled: RunGoalCheck = { id: target.id, text: target.text, state, evidence: reason };
  return {
    resolved: true,
    goal: {
      statement: goal.statement,
      checks: goal.checks.map((check) => (check.id === checkId ? settled : check)),
    },
  };
}

export function openChecks(goal: RunGoal | undefined): readonly RunGoalCheck[] {
  return goal?.checks.filter((check) => check.state === 'open') ?? [];
}

/**
 * Whether the run may declare itself complete.
 *
 * `abandoned` is always allowed. Refusing to let a run give up would trap it in
 * a loop against a goal it has already decided it cannot meet, which is a worse
 * outcome than an honest abandonment — and the terminal record says which it
 * was.
 */
export function goalPermitsEnd(
  goal: RunGoal | undefined,
  lifecycle: 'completed' | 'abandoned',
): { readonly allowed: true } | { readonly allowed: false; readonly refusal: string } {
  if (lifecycle === 'abandoned') return { allowed: true };
  const open = openChecks(goal);
  if (open.length === 0) return { allowed: true };
  return {
    allowed: false,
    refusal: `${String(open.length)} acceptance check(s) are still open: ${open
      .map((check) => `${check.id} (${check.text})`)
      .join('; ')}. Resolve or waive each one, or end as abandoned.`,
  };
}
