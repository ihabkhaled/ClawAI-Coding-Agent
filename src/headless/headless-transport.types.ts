/** Credentials for a non-interactive sign-in, supplied by the caller's environment. */
export interface HeadlessCredentials {
  readonly email: string;
  readonly password: string;
}

/** The run start request, shaped by the runtime contract rather than by this runner. */
export interface HeadlessRunRequest {
  readonly schemaVersion: '2.0';
  readonly threadId: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly prompt: string;
  readonly manifestHash: string;
  readonly toolCatalogHash: string;
  readonly toolDefinitions: readonly unknown[];
  readonly provider: string;
  readonly model: string;
  readonly epochs: Readonly<Record<string, number>>;
  readonly budget: Readonly<Record<string, number>>;
}
