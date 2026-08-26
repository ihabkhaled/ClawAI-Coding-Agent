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
import {
  asStreamTransportFailure,
  isResumableStreamFailure,
  streamResumeDelayMs,
  waitBeforeStreamResume,
} from '../core/runtime/runtime-stream-resume';
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
    initialCursor = -1,
  ): Promise<void> {
    // A mutable holder, because the cursor has to survive a stream that throws
    // partway through. Returning it only on success meant a broken connection
    // discarded every event already consumed, so a resumed stream would replay
    // work the run had done.
    if (!Number.isInteger(initialCursor) || initialCursor < -1) {
      throw new Error('Runtime stream cursor is invalid');
    }
    const progress = { cursor: initialCursor };
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
    let attempt = 0;
    try {
      while (!signal.aborted) {
        try {
          const response = await interruptRuntimeStreamOperation(
            () =>
              this.transportBackendStream(runId, progress.cursor, transportController.signal).catch(
                asStreamTransportFailure,
              ),
            dispatchState,
            signal,
          );
          const terminal = await this.consume(
            response,
            runtime,
            observer,
            signal,
            progress,
            dispatchState,
          );
          attempt = 0;
          if (terminal) return;
        } catch (error: unknown) {
          // The server closing the stream cleanly was already survivable: the
          // loop reopened from the cursor. The connection breaking was not,
          // and the run has no reason to care which of the two happened —
          // its state is in the backend either way.
          attempt += 1;
          if (!isResumableStreamFailure(error, attempt, signal, dispatchState)) throw error;
          observer.onStreamResume?.(attempt, error);
          await waitBeforeStreamResume(streamResumeDelayMs(attempt), signal);
        }
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
    progress: { cursor: number },
    dispatchState: RuntimeDispatchState,
  ): Promise<boolean> {
    throwRuntimeDispatchFailure(dispatchState);
    if (response.body === null)
      asStreamTransportFailure(new Error('Runtime event stream has no response body'));
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const events = new SseDecoder();
    try {
      while (!signal.aborted) {
        const chunk = await interruptRuntimeStreamOperation(
          () => reader.read().catch(asStreamTransportFailure),
          dispatchState,
          signal,
        );
        if (chunk.done) {
          throwRuntimeDispatchFailure(dispatchState);
          return false;
        }
        for (const candidate of events.push(decoder.decode(chunk.value, { stream: true }))) {
          throwRuntimeDispatchFailure(dispatchState);
          if (candidate.type === 'HEARTBEAT') continue;
          const event = readRuntimeStreamEvent(candidate);
          if (event.sequence <= progress.cursor) continue;
          progress.cursor = event.sequence;
          throwRuntimeDispatchFailure(dispatchState);
          await observer.onEvent(event);
          if (event.type === 'tool.requested') {
            // The run ended on this side while the backend was still streaming.
            // Nothing is left to dispatch into, and the frames that follow
            // describe a run the user has already stopped caring about.
            if (!runtime.hasActiveRun()) return true;
            const invocation = parseToolInvocation(event.payload.invocation);
            try {
              runtime.beginModelTurn(false, invocation.turnId);
            } catch (error: unknown) {
              // The run ended between the frame arriving and this turn opening
              // — the step just dispatched was denied or blocked. Nothing is
              // left to dispatch into; the sentence this used to raise reached
              // the user as the assistant's whole answer.
              if (error instanceof RuntimeRunEndedError) return true;
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
            return true;
          }
        }
      }
      signal.throwIfAborted();
      return false;
    } finally {
      void reader.cancel().catch(() => undefined);
    }
  }
}
