import { RuntimeHttpError } from '../headless/runtime-http-error';

import { HEADLESS_AUTH_STATUSES, HEADLESS_EXIT_CODES } from './headless-outcome.constants';

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
 * - `2` unusable — a usage error: a missing prompt, an unknown flag, an
 *   unreadable workspace. Nothing was attempted.
 * - `3` unauthenticated — no credential, or the backend refused the one given.
 * - `4` blocked — permission denied. A policy refused a tool or an approval was
 *   declined. Retrying unchanged will block again.
 * - `5` exhausted — a budget ran out: turns, tool calls, or time. The work may
 *   be fine and simply larger than the allowance it was given.
 * - `130` cancelled — a person or a signal stopped it (the shell's SIGINT code).
 *
 * `3`, `4`, `5` and `130` are deliberately not `1`. Each has a different
 * remedy, and collapsing them loses the only information the pipeline had.
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
    unauthenticated: 'The run never started, because no usable credential was accepted.',
    blocked:
      'The run needed something that was not granted, and retrying unchanged will block again.',
    cancelled: 'The run was stopped deliberately.',
    exhausted: 'The run ran out of budget before it finished.',
  };
  return messages[outcome];
}

/**
 * An exception out of a run, read as an outcome.
 *
 * An abort wins over everything else, because the error an aborted fetch throws
 * is an artefact of the cancel rather than a separate failure. A refused
 * credential is `unauthenticated`: during sign-in any client error means the
 * credential, afterwards only the statuses that name it do.
 */
export function outcomeFromError(
  error: unknown,
  context: { aborted: boolean; signingIn: boolean },
): HeadlessOutcome {
  if (context.aborted) return 'cancelled';
  if (!(error instanceof RuntimeHttpError)) return 'failed';
  if (context.signingIn && error.status >= 400 && error.status < 500) return 'unauthenticated';
  return HEADLESS_AUTH_STATUSES.includes(error.status) ? 'unauthenticated' : 'failed';
}
