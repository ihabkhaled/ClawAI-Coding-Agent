/** Where spans are sent, and with what. */
export interface OtlpEndpoint {
  /** The full traces URL, already validated. */
  readonly url: string;
  /** Headers the collector needs, typically one authorization entry. */
  readonly headers: Readonly<Record<string, string>>;
}

/** One OTLP/HTTP JSON request body, ready to post. */
export interface OtlpTracePayload {
  readonly resourceSpans: readonly unknown[];
}

/** One OTLP/HTTP JSON metrics request body, ready to post. */
export interface OtlpMetricsPayload {
  readonly resourceMetrics: readonly unknown[];
}

/** One sum data point: a run's contribution to a metric. */
export interface OtlpDataPoint {
  readonly attributes: readonly unknown[];
  readonly startTimeUnixNano: string;
  readonly timeUnixNano: string;
  /** int64 on the wire, which OTLP JSON encodes as a decimal string. */
  readonly asInt: string;
}

/** The points for one metric name, gathered across a batch of runs. */
export interface OtlpMetricSeries {
  readonly unit: string;
  readonly description: string;
  readonly points: OtlpDataPoint[];
}
