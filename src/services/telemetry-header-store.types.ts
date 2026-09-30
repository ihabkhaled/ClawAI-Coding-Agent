/** SecretStorage, narrowed to what the telemetry headers need. */
export interface TelemetrySecretPort {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

/** The old `clawAI.telemetryHeaders` setting, read once to migrate and then cleared. */
export interface LegacyTelemetryHeadersPort {
  read(): Readonly<Record<string, string>>;
  clear(): PromiseLike<void>;
}

/** Where a migration or load problem is reported. Never given a header value. */
export interface TelemetryHeaderLog {
  warn(message: string): void;
  info(message: string): void;
}

/** SecretStorage with its change event, so every window picks up a header set in any one. */
export interface WatchedTelemetrySecretPort extends TelemetrySecretPort {
  onDidChange(listener: (event: { readonly key: string }) => unknown): { dispose(): unknown };
}

/** The slice of the extension context the header store is started with. */
export interface TelemetryHeaderContext {
  readonly secrets: WatchedTelemetrySecretPort;
  readonly subscriptions: { dispose(): unknown }[];
}
