import { HEADLESS_EXIT_CODES } from './headless-outcome.constants';

import type { HeadlessExitCode, HeadlessOutcome } from './headless-outcome.types';

/**
 * What a non-interactive run tells the process that started it.
 *
 * A headless runner's only output that a pipeline can act on is its exit code,
 * and the difference that matters most is not success versus failure. It is
 * "the agent did the work and the work was wrong" versus "the agent never got
 * to try". A runner that returns 1 for both turns a missing credential into a
 * failing test, and someone spends an afternoon debugging a task that never ran.
 *
 * So the codes separate the reasons rather than the verdict:
 *
 * - `0` completed — the run reached its own end. Whether the result is any good
 *   is the caller's question, not this one's.
 * - `1` failed — the run ran and did not finish. This is the honest failure.
 * - `2` unusable — the runner could not start: missing credentials, an
 *   unreadable workspace, a malformed request. Nothing was attempted.
 * - `3` blocked — something the run needed was not granted. A policy refused it
 *   or an approval never came. Retrying unchanged will block again.
 * - `4` cancelled — a person or a signal stopped it. Not a defect.
 * - `5` exhausted — a budget ran out: turns, tool calls, or time. The work may
 *   be fine and simply larger than the allowance it was given.
 *
 * `3`, `4` and `5` are deliberately not `1`. Each has a different remedy, and
 * collapsing them loses the only information the pipeline had.
 */
export function headlessExitCode(outcome: HeadlessOutcome): HeadlessExitCode {
  return HEADLESS_EXIT_CODES[outcome];
}

/**
 * The terminal event a run ended on, read as an outcome.
 *
 * An unknown or absent terminal event is treated as `failed` rather than
 * `completed`. A run whose ending nobody recognised did not demonstrably
 * succeed, and defaulting to success is how a broken stream reports green.
 */
export function outcomeFromTerminalEvent(eventType: string | undefined): HeadlessOutcome {
  if (eventType === 'run.completed') return 'completed';
  if (eventType === 'run.cancelled') return 'cancelled';
  if (eventType === 'run.blocked') return 'blocked';
  return 'failed';
}

/**
 * One line a human can read in a log without knowing the code table.
 *
 * The number is for the pipeline; this is for the person reading why the
 * pipeline stopped.
 */
export function describeHeadlessOutcome(outcome: HeadlessOutcome): string {
  const messages: Record<HeadlessOutcome, string> = {
    completed: 'The run reached its end.',
    failed: 'The run started and did not finish.',
    unusable: 'The run never started, because the runner could not be configured.',
    blocked:
      'The run needed something that was not granted, and retrying unchanged will block again.',
    cancelled: 'The run was stopped deliberately.',
    exhausted: 'The run ran out of budget before it finished.',
  };
  return messages[outcome];
}
