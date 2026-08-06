import { randomUUID } from 'node:crypto';

import { RuntimeRunEndedError } from '../core/runtime/runtime-invocation-registry';
import { parseRuntimeEvent, type RuntimeEvent } from '../core/runtime/runtime-protocol.schemas';
import {
  parseToolInvocation,
  type Continuation,
  type ToolInvocation,
} from '../core/runtime/runtime-tool-contracts';
import { SseDecoder } from '../core/sse-decoder';

import type { BackendRuntimeTransport } from '../infrastructure/backend-runtime-transport';

export interface RuntimeStreamObserver {
  readonly onEvent: (event: RuntimeEvent) => void | Promise<void>;
}

export interface RuntimeStreamRuntimePort {
  beginModelTurn(repair: boolean, turnId: string): unknown;
  dispatch(invocation: ToolInvocation, continuation: Continuation): Promise<unknown>;
  /**
   * Whether the local run this stream belongs to is still open.
   *
   * A run can end on this side first — the user cancels, or denies a tool — and
   * the backend keeps streaming until it learns of it. Those late frames used
   * to be handed to `beginModelTurn`, which threw "No runtime run is active"
   * and put that internal sentence in front of the user as the answer.
   */
  hasActiveRun(): boolean;
}

function isTerminalEvent(event: RuntimeEvent): boolean {
  return ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type);
}

function errorFrom(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function throwDispatchFailure(state: { readonly failure?: unknown }): void {
  if (state.failure !== undefined) throw errorFrom(state.failure);
}

/**
 * Parses one stream frame, or fails with something a person can read.
 *
 * A frame the schema rejects used to surface the raw Zod issue list — the panel
 * showed `[{"code":"invalid_value","values":["2.0"],"path":["schemaVersion"]…}]`
 * as the assistant's response. When the frame is a platform error envelope its
 * own reason is the honest thing to report; otherwise say plainly that the
 * event could not be read.
 */
function readRuntimeEvent(candidate: unknown): RuntimeEvent {
  try {
    return parseRuntimeEvent(candidate);
  } catch (error: unknown) {
    const reason = errorEnvelopeReason(candidate);
    if (reason !== undefined) throw new Error(reason);
    throw new Error(
      `The ClawAI stream sent an event this version cannot read: ${frameKind(candidate)}`,
      { cause: error },
    );
  }
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

export class RuntimeEventStreamService {
  constructor(private readonly transport: BackendRuntimeTransport) {}

  async follow(
    runId: string,
    runtime: RuntimeStreamRuntimePort,
    observer: RuntimeStreamObserver,
    signal: AbortSignal,
  ): Promise<void> {
    let cursor = -1;
    while (!signal.aborted) {
      const response = await this.transportBackendStream(runId, cursor, signal);
      const outcome = await this.consume(response, runtime, observer, signal, cursor);
      cursor = outcome.cursor;
      if (outcome.terminal) return;
    }
    signal.throwIfAborted();
  }

  private transportBackendStream(
    runId: string,
    after: number,
    signal: AbortSignal,
  ): Promise<Response> {
    return this.transport.openStream(runId, after, signal);
  }

  private async consume(
    response: Response,
    runtime: RuntimeStreamRuntimePort,
    observer: RuntimeStreamObserver,
    signal: AbortSignal,
    initialCursor: number,
  ): Promise<{ readonly cursor: number; readonly terminal: boolean }> {
    if (response.body === null) throw new Error('Runtime event stream has no response body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const events = new SseDecoder();
    const pendingDispatches = new Set<Promise<void>>();
    const dispatchState: { failure?: unknown } = {};
    let cursor = initialCursor;
    try {
      while (!signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) return { cursor, terminal: false };
        for (const candidate of events.push(decoder.decode(chunk.value, { stream: true }))) {
          if (candidate.type === 'HEARTBEAT') continue;
          const event = readRuntimeEvent(candidate);
          if (event.sequence <= cursor) continue;
          cursor = event.sequence;
          throwDispatchFailure(dispatchState);
          await observer.onEvent(event);
          if (event.type === 'tool.requested') {
            // The run ended on this side while the backend was still streaming.
            // Nothing is left to dispatch into, and the frames that follow
            // describe a run the user has already stopped caring about.
            if (!runtime.hasActiveRun()) return { cursor, terminal: true };
            const invocation = parseToolInvocation(event.payload.invocation);
            try {
              runtime.beginModelTurn(false, invocation.turnId);
            } catch (error: unknown) {
              // The run ended between the frame arriving and this turn opening
              // — the step just dispatched was denied or blocked. Nothing is
              // left to dispatch into; the sentence this used to raise reached
              // the user as the assistant's whole answer.
              if (error instanceof RuntimeRunEndedError) return { cursor, terminal: true };
              throw error;
            }
            const dispatch = runtime
              .dispatch(invocation, {
                action: 'continue',
                nextTurnId: `turn_${randomUUID()}`,
              })
              .then(() => undefined)
              .catch((error: unknown) => {
                dispatchState.failure = error;
              })
              .finally(() => {
                pendingDispatches.delete(dispatch);
              });
            pendingDispatches.add(dispatch);
          }
          if (isTerminalEvent(event)) {
            await Promise.all(pendingDispatches);
            throwDispatchFailure(dispatchState);
            return { cursor, terminal: true };
          }
        }
      }
      signal.throwIfAborted();
      return { cursor, terminal: false };
    } finally {
      await Promise.all(pendingDispatches);
      await reader.cancel().catch(() => undefined);
    }
  }
}
