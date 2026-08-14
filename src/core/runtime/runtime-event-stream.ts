import { parseRuntimeEvent, type RuntimeEvent } from './runtime-protocol.schemas';
import { asStreamTransportFailure } from './runtime-stream-resume';
import { TRANSIENT_RUNTIME_STATE_CODES } from './runtime-stream-resume.constants';

import type { RuntimeDispatchState } from './runtime-event-stream.types';

export function isTerminalRuntimeEvent(event: RuntimeEvent): boolean {
  return ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type);
}

function errorFrom(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function throwRuntimeDispatchFailure(state: RuntimeDispatchState): void {
  if (state.failure !== undefined) throw errorFrom(state.failure);
}

export function recordRuntimeDispatchFailure(state: RuntimeDispatchState, value: unknown): void {
  if (state.failure !== undefined) return;
  state.failure = errorFrom(value);
  state.failureController.abort(state.failure);
}

export function linkRuntimeAbortSignals(
  controller: AbortController,
  callerSignal: AbortSignal,
  dispatchFailureSignal: AbortSignal,
): () => void {
  const abortFromCaller = (): void => {
    controller.abort(callerSignal.reason);
  };
  const abortFromDispatchFailure = (): void => {
    controller.abort(dispatchFailureSignal.reason);
  };
  callerSignal.addEventListener('abort', abortFromCaller, { once: true });
  dispatchFailureSignal.addEventListener('abort', abortFromDispatchFailure, { once: true });
  if (callerSignal.aborted) abortFromCaller();
  else if (dispatchFailureSignal.aborted) abortFromDispatchFailure();
  return () => {
    callerSignal.removeEventListener('abort', abortFromCaller);
    dispatchFailureSignal.removeEventListener('abort', abortFromDispatchFailure);
  };
}

export async function interruptRuntimeStreamOperation<T>(
  operation: () => Promise<T>,
  dispatchState: RuntimeDispatchState,
  signal: AbortSignal,
): Promise<T> {
  let rejectInterruption: (reason: unknown) => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectInterruption = reject;
  });
  const onAbort = (): void => {
    rejectInterruption(signal.reason ?? new Error('Runtime event stream aborted'));
  };
  const onDispatchFailure = (): void => {
    rejectInterruption(
      dispatchState.failure ?? new Error('Runtime tool dispatch failed without an error'),
    );
  };
  signal.addEventListener('abort', onAbort, { once: true });
  dispatchState.failureController.signal.addEventListener('abort', onDispatchFailure, {
    once: true,
  });
  try {
    signal.throwIfAborted();
    throwRuntimeDispatchFailure(dispatchState);
    return await Promise.race([operation(), interrupted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
    dispatchState.failureController.signal.removeEventListener('abort', onDispatchFailure);
  }
}

/** Parses one stream frame, preserving a platform error envelope's readable reason. */
export function readRuntimeStreamEvent(candidate: unknown): RuntimeEvent {
  try {
    return parseRuntimeEvent(candidate);
  } catch (error: unknown) {
    // A backend that cannot reach its own state store is reporting on itself,
    // not on the run — the run is in Redis and outlives the process. This
    // arrives as an ordinary error frame over an HTTP 200 stream, so without
    // tagging it the reconnect logic never sees a transport failure at all:
    // the service restarts, answers the reopened stream with this code, and
    // the run dies four seconds after asking for a commit that was still fine.
    if (isTransientStateEnvelope(candidate)) {
      asStreamTransportFailure(new Error(errorEnvelopeReason(candidate) ?? 'Runtime state store'));
    }
    const reason = errorEnvelopeReason(candidate);
    if (reason !== undefined) throw new Error(reason);
    throw new Error(
      `The ClawAI stream sent an event this version cannot read: ${frameKind(candidate)}`,
      { cause: error },
    );
  }
}

/**
 * Whether an error frame describes the backend's own availability.
 *
 * Deliberately a fixed, tiny list. Every other code the backend can send is a
 * statement about the run — a denied effect, a stale epoch, an invalid
 * argument — and reopening the stream would replay it under a different name.
 */
function isTransientStateEnvelope(candidate: unknown): boolean {
  if (candidate === null || typeof candidate !== 'object') return false;
  const code = (candidate as Record<string, unknown>).code;
  return typeof code === 'string' && TRANSIENT_RUNTIME_STATE_CODES.includes(code.trim());
}

function errorEnvelopeReason(candidate: unknown): string | undefined {
  if (candidate === null || typeof candidate !== 'object') return undefined;
  const record = candidate as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message.trim() : '';
  if (message.length === 0) return undefined;
  const code = typeof record.code === 'string' ? record.code.trim() : '';
  return code.length === 0 ? message : `${message} (${code})`;
}

function frameKind(candidate: unknown): string {
  if (candidate === null || typeof candidate !== 'object') return typeof candidate;
  const type = (candidate as Record<string, unknown>).type;
  return typeof type === 'string' && type.length > 0 ? type : 'unknown';
}
