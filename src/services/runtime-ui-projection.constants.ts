/**
 * The event names that carry a phase change.
 *
 * Two, because the protocol emits `run.phase.changed` and the reducer
 * normalises it to `run.phase`. The projection sees events before that
 * normalisation on some paths and after it on others, so it must answer to
 * both — matching only one is how phase updates silently stopped reaching the
 * panel.
 */
export const RUNTIME_PHASE_EVENTS: readonly string[] = ['run.phase', 'run.phase.changed'];

/** Why a steering message was refused, in the order a reader cares about. */
export const STEERING_REJECTION_REASONS: readonly string[] = [
  'stale-epochs',
  'run-cancelled',
  'run-terminal',
];
