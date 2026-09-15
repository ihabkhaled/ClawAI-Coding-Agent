import { DEFAULT_SPEED_MODE } from './speed-mode';

import type { FastModeSettings } from './fast-mode.types';

/**
 * What "fast" means, on both of the levers that exist.
 *
 * These are genuinely two different mechanisms and the documentation must not
 * pretend otherwise. `LOW_LATENCY` asks the backend router for a model that
 * answers quickly. `2X` lets the extension issue eight workspace metadata
 * lookups at a time instead of one while it builds the context envelope. One is
 * a model choice made on a server; the other is local syscall concurrency.
 *
 * They belong behind one control anyway, because a person asking for a fast
 * reply is not asking about either mechanism. They are asking for the whole
 * round trip to be shorter, and moving one lever while leaving the other buys
 * half of it.
 *
 * Neither lever trades correctness. The router still picks a capable model, and
 * `2X` changes only how many stats are in flight — the file set, the byte
 * budget, the inclusion order, approvals, writes and commands are all
 * untouched.
 */
export const FAST_MODE: FastModeSettings = { routingMode: 'LOW_LATENCY', speedMode: '2X' };

/** The pair Fast mode returns to when nothing was remembered. */
export const FAST_MODE_FALLBACK: FastModeSettings = {
  routingMode: 'AUTO',
  speedMode: DEFAULT_SPEED_MODE,
};

/**
 * Fast mode is on only when BOTH levers are where it put them.
 *
 * Reporting it on for a half-match would light the toggle for someone who
 * chose `LOW_LATENCY` themselves and never asked for the local concurrency,
 * and turning it off would then quietly change a setting they did choose.
 */
export function isFastMode(current: FastModeSettings): boolean {
  return current.routingMode === FAST_MODE.routingMode && current.speedMode === FAST_MODE.speedMode;
}

/**
 * What to apply, and what to remember so it can be undone.
 *
 * A manually chosen model is deliberately not remembered: Fast mode moves off
 * `MANUAL_MODEL`, and restoring a manual selection would put back a model that
 * may have left the catalog in the meantime. The fallback is automatic routing,
 * which is always valid.
 */
export function enableFastMode(current: FastModeSettings): {
  apply: FastModeSettings;
  remember: FastModeSettings;
} {
  return {
    apply: FAST_MODE,
    remember: isFastMode(current) ? FAST_MODE_FALLBACK : current,
  };
}

/** What to apply when the toggle goes off. */
export function disableFastMode(remembered: FastModeSettings | undefined): FastModeSettings {
  return remembered ?? FAST_MODE_FALLBACK;
}
