import { randomUUID } from 'node:crypto';

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
          const event = parseRuntimeEvent(candidate);
          if (event.sequence <= cursor) continue;
          cursor = event.sequence;
          throwDispatchFailure(dispatchState);
          await observer.onEvent(event);
          if (event.type === 'tool.requested') {
            const invocation = parseToolInvocation(event.payload.invocation);
            runtime.beginModelTurn(false, invocation.turnId);
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
