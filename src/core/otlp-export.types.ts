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
