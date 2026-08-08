import { randomUUID } from 'node:crypto';

import {
  interruptRuntimeStreamOperation,
  isTerminalRuntimeEvent,
  linkRuntimeAbortSignals,
  readRuntimeStreamEvent,
  recordRuntimeDispatchFailure,
  throwRuntimeDispatchFailure,
} from '../core/runtime/runtime-event-stream';
import { RuntimeRunEndedError } from '../core/runtime/runtime-invocation-registry';
import { parseToolInvocation } from '../core/runtime/runtime-tool-contracts';
import { SseDecoder } from '../core/sse-decoder';

import type {
  RuntimeStreamObserver,
  RuntimeStreamRuntimePort,
} from './runtime-event-stream-service.types';
import type { RuntimeDispatchState } from '../core/runtime/runtime-event-stream.types';
import type { BackendRuntimeTransport } from '../infrastructure/backend-runtime-transport';

export type {
  RuntimeStreamObserver,
  RuntimeStreamRuntimePort,
} from './runtime-event-stream-service.types';

/** Follows a runtime event stream and dispatches admitted tool requests. */
export class RuntimeEventStreamService {
  constructor(private readonly transport: BackendRuntimeTransport) {}

  async follow(
    runId: string,
    runtime: RuntimeStreamRuntimePort,
    observer: RuntimeStreamObserver,
    signal: AbortSignal,
  ): Promise<void> {
    let cursor = -1;
    const dispatchState: RuntimeDispatchState = {
      failureController: new AbortController(),
      pendingDispatches: new Set<Promise<void>>(),
    };
    const transportController = new AbortController();
    const unlinkTransportSignal = linkRuntimeAbortSignals(
      transportController,
      signal,
      dispatchState.failureController.signal,
    );
    try {
      while (!signal.aborted) {
        const response = await interruptRuntimeStreamOperation(
          () => this.transportBackendStream(runId, cursor, transportController.signal),
          dispatchState,
          signal,
        );
        const outcome = await this.consume(
          response,
          runtime,
          observer,
          signal,
          cursor,
          dispatchState,
        );
        cursor = outcome.cursor;
        if (outcome.terminal) return;
      }
      signal.throwIfAborted();
    } finally {
      unlinkTransportSignal();
      transportController.abort();
    }
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
    dispatchState: RuntimeDispatchState,
  ): Promise<{ readonly cursor: number; readonly terminal: boolean }> {
    throwRuntimeDispatchFailure(dispatchState);
    if (response.body === null) throw new Error('Runtime event stream has no response body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const events = new SseDecoder();
    let cursor = initialCursor;
    try {
      while (!signal.aborted) {
        const chunk = await interruptRuntimeStreamOperation(
          () => reader.read(),
          dispatchState,
          signal,
        );
        if (chunk.done) {
          throwRuntimeDispatchFailure(dispatchState);
          return { cursor, terminal: false };
        }
        for (const candidate of events.push(decoder.decode(chunk.value, { stream: true }))) {
          throwRuntimeDispatchFailure(dispatchState);
          if (candidate.type === 'HEARTBEAT') continue;
          const event = readRuntimeStreamEvent(candidate);
          if (event.sequence <= cursor) continue;
          cursor = event.sequence;
          throwRuntimeDispatchFailure(dispatchState);
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
                recordRuntimeDispatchFailure(dispatchState, error);
              })
              .finally(() => {
                dispatchState.pendingDispatches.delete(dispatch);
              });
            dispatchState.pendingDispatches.add(dispatch);
          }
          if (isTerminalRuntimeEvent(event)) {
            await interruptRuntimeStreamOperation(
              () => Promise.all(dispatchState.pendingDispatches).then(() => undefined),
              dispatchState,
              signal,
            );
            throwRuntimeDispatchFailure(dispatchState);
            return { cursor, terminal: true };
          }
        }
      }
      signal.throwIfAborted();
      return { cursor, terminal: false };
    } finally {
      void reader.cancel().catch(() => undefined);
    }
  }
}
