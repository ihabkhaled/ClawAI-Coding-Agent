import { randomUUID } from 'node:crypto';

import { parseRuntimeEvent, type RuntimeEvent } from '../core/runtime/runtime-protocol.schemas';
import { parseToolInvocation } from '../core/runtime/runtime-tool-contracts';
import { SseDecoder } from '../core/sse-decoder';

import type { RuntimeRunService } from './runtime-run-service';
import type { BackendRuntimeTransport } from '../infrastructure/backend-runtime-transport';

export interface RuntimeStreamObserver {
  readonly onEvent: (event: RuntimeEvent) => void;
}

export class RuntimeEventStreamService {
  constructor(private readonly transport: BackendRuntimeTransport) {}

  async follow(
    runId: string,
    runtime: RuntimeRunService,
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
    runtime: RuntimeRunService,
    observer: RuntimeStreamObserver,
    signal: AbortSignal,
    initialCursor: number,
  ): Promise<{ readonly cursor: number; readonly terminal: boolean }> {
    if (response.body === null) throw new Error('Runtime event stream has no response body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const events = new SseDecoder();
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
          observer.onEvent(event);
          if (event.type === 'tool.requested') {
            const invocation = parseToolInvocation(event.payload.invocation);
            runtime.beginModelTurn(false, invocation.turnId);
            await runtime.dispatch(invocation, {
              action: 'continue',
              nextTurnId: `turn_${randomUUID()}`,
            });
          }
          if (
            event.type === 'run.completed' ||
            event.type === 'run.failed' ||
            event.type === 'run.cancelled'
          )
            return { cursor, terminal: true };
        }
      }
      signal.throwIfAborted();
      return { cursor, terminal: false };
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
}
