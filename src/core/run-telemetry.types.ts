/**
 * What one finished run cost and did, as counts rather than content.
 *
 * Exported as OTLP metrics. Nothing here is text a user wrote or a tool
 * returned: tool names are catalog identifiers, and every other field is a
 * number, so the metrics path needs no redaction at all.
 */
export interface RunUsage {
  readonly runId: string;
  readonly status: 'ok' | 'error';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly toolCalls: number;
  readonly toolFailures: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Integer micro-USD, present only when the backend reported a cost. */
  readonly costMicros?: number;
  /** Calls per tool name, so a dashboard can say which tools a team leans on. */
  readonly toolsByName: Readonly<Record<string, number>>;
}

/** A tool invocation seen requested but not yet completed. */
export interface PendingToolCall {
  readonly toolName: string;
  readonly operation: string;
  startedAt: string;
}
