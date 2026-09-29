import type { PendingToolCall, RunUsage } from './run-telemetry.types';
import type { RuntimeEvent } from './runtime/runtime-protocol.schemas';
import type { ObservabilitySpan } from '../services/observability-service';

const FAILED_TOOL_STATUSES = new Set(['failed', 'denied', 'cancelled', 'timed-out']);

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Turns one run's event stream into tool spans and a usage record.
 *
 * Reads payload fields defensively, the way the sub-agent executor does: the
 * token counts and cost ride on whichever events the backend attaches them to,
 * and an event without them is ordinary rather than malformed. Cost is only
 * reported when the backend sent one — a zero would read as "free".
 *
 * Tool spans carry the tool name, the operation and the outcome, never the
 * arguments or the result. Content stays on the machine by construction, not
 * by trusting a redactor to catch it.
 */
export class RunTelemetryRecorder {
  private readonly pending = new Map<string, PendingToolCall>();
  private readonly toolsByName: Record<string, number> = {};
  private toolCalls = 0;
  private toolFailures = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private costMicros: number | undefined;

  constructor(
    private readonly traceId: string,
    private readonly parentSpanId: string,
  ) {}

  /** The finished tool span this event closes, if it closes one. */
  observe(event: RuntimeEvent): ObservabilitySpan | undefined {
    this.inputTokens += count(event.payload.inputTokens);
    this.outputTokens += count(event.payload.outputTokens);
    if (typeof event.payload.costMicros === 'number') {
      this.costMicros = (this.costMicros ?? 0) + count(event.payload.costMicros);
    }
    const invocationId = text(event.payload.invocationId);
    if (invocationId === undefined) return undefined;
    if (event.type === 'tool.requested') this.requested(invocationId, event);
    if (event.type === 'tool.started') {
      const call = this.pending.get(invocationId);
      if (call !== undefined) call.startedAt = event.timestamp;
    }
    return event.type === 'tool.completed' ? this.completed(invocationId, event) : undefined;
  }

  usage(
    runId: string,
    status: RunUsage['status'],
    startedAt: string,
    completedAt: string,
  ): RunUsage {
    return {
      runId,
      status,
      startedAt,
      completedAt,
      toolCalls: this.toolCalls,
      toolFailures: this.toolFailures,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      ...(this.costMicros === undefined ? {} : { costMicros: this.costMicros }),
      toolsByName: { ...this.toolsByName },
    };
  }

  private requested(invocationId: string, event: RuntimeEvent): void {
    const toolName = text(event.payload.toolName) ?? 'unknown';
    this.toolCalls += 1;
    this.toolsByName[toolName] = (this.toolsByName[toolName] ?? 0) + 1;
    this.pending.set(invocationId, {
      toolName,
      operation: text(event.payload.operation) ?? 'unknown',
      startedAt: event.timestamp,
    });
  }

  private completed(invocationId: string, event: RuntimeEvent): ObservabilitySpan | undefined {
    const call = this.pending.get(invocationId);
    if (call === undefined) return undefined;
    this.pending.delete(invocationId);
    const outcome = text(event.payload.status) ?? 'unknown';
    const failed = FAILED_TOOL_STATUSES.has(outcome);
    if (failed) this.toolFailures += 1;
    return {
      name: 'runtime.v2.tool',
      traceId: this.traceId,
      spanId: `span:${invocationId}`,
      parentSpanId: this.parentSpanId,
      startedAt: call.startedAt,
      completedAt: event.timestamp,
      status: failed ? 'error' : 'ok',
      attributes: { 'tool.name': call.toolName, 'tool.operation': call.operation, outcome },
    };
  }
}
