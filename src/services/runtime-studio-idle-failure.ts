import { RuntimeStreamIdleError } from '../core/runtime/runtime-stream-idle';
import { RUNTIME_STREAM_IDLE_MESSAGE } from '../core/runtime/runtime-stream-idle.constants';

import { RUNTIME_STREAM_IDLE_FAILURE_CODE } from './runtime-studio-idle-failure.constants';

import type { ExtensionState } from '../core/extension-state';
import type { RuntimeEvent } from '../core/runtime/runtime-protocol.schemas';

/** Shared by both studio entry points; the run-ending flags the `finally` reads. */
export interface RuntimeStudioOutcome {
  /** The run reached an end state of its own. */
  ended: boolean;
  /** The idle failure was already shown, so a cleanup cancel must stay silent in the UI. */
  idleFailed: boolean;
}

export interface RuntimeIdleFailureTarget {
  readonly runId: string;
  readonly epochs: RuntimeEvent['epochs'];
  readonly state: ExtensionState;
  readonly toPanel: (event: RuntimeEvent) => void;
  readonly record?: (event: RuntimeEvent) => Promise<void>;
}

/** The user-facing, translated reason for an idle failure. */
export async function runtimeIdleMessage(): Promise<string> {
  // Loaded on demand so the studio stays importable outside the extension host
  // (unit tests), where the English text is the right fallback.
  try {
    const vscode = await import('vscode');
    return vscode.l10n.t('The run stopped responding');
  } catch {
    return RUNTIME_STREAM_IDLE_MESSAGE;
  }
}

/**
 * Ends a run whose stream went idle as `run.failed`, carrying the idle reason.
 *
 * Built on the reducer's own ledger (`lastSequence + 1`) so it is admitted like
 * any backend event. Without it, the cleanup cancel was the only ending and the
 * panel showed what looked like the user's own cancel.
 */
export async function publishIdleFailure(
  target: RuntimeIdleFailureTarget,
  outcome: RuntimeStudioOutcome,
): Promise<void> {
  outcome.idleFailed = true;
  const run = target.state.snapshot.runtime.runs[target.runId];
  const sequence = (run?.lastSequence ?? 0) + 1;
  const event: RuntimeEvent = {
    schemaVersion: '2.0',
    epochs: run?.epochs ?? target.epochs,
    eventId: `event:${target.runId}:${String(sequence)}`,
    runId: target.runId,
    sequence,
    sensitivity: 'sensitive-redacted',
    timestamp: new Date().toISOString(),
    type: 'run.failed',
    visibility: 'user',
    payload: {
      reason: { code: RUNTIME_STREAM_IDLE_FAILURE_CODE, message: await runtimeIdleMessage() },
    },
  };
  outcome.ended = true;
  try {
    target.state.applyRuntimeEvent(event);
  } catch {
    // The panel still has to hear the ending when the local ledger refuses it.
  }
  if (target.record !== undefined) await target.record(event).catch(() => undefined);
  target.toPanel(event);
}

/**
 * Turns an idle-watchdog error into the failure the user sees. Returns the
 * translated error to throw, or `undefined` when `error` is not an idle error
 * and must propagate as it is. Without a followed run there is nothing to end.
 */
export async function endIdleRun(
  error: unknown,
  target: RuntimeIdleFailureTarget | undefined,
  outcome: RuntimeStudioOutcome,
): Promise<Error | undefined> {
  if (!(error instanceof RuntimeStreamIdleError)) return undefined;
  if (target !== undefined) await publishIdleFailure(target, outcome);
  return new Error(await runtimeIdleMessage());
}
