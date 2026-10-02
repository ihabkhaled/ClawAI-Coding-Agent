/** A tool definition as the runtime sends it; a stub carries `deferred`. */
export interface WireToolDefinition {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly operations: readonly string[];
  readonly [key: string]: unknown;
}

/** What the backend answers to a load: the catalog's new version and what it admitted. */
export interface DeferredLoadAck {
  readonly catalogVersion: number;
  readonly loaded: readonly { readonly name: string; readonly version: string }[];
}

/** Loads full definitions into the running run; bound once the run exists. */
export type DeferredToolLoader = (
  definitions: readonly WireToolDefinition[],
  signal?: AbortSignal,
) => Promise<DeferredLoadAck>;

/** The start catalog split into what is sent and what waits for a search. */
export interface DeferredCatalog {
  /** What the start request carries: whole definitions, stubs, and the search tool. */
  readonly wire: readonly unknown[];
  /** The full definitions behind the stubs, in catalog order. */
  readonly deferred: readonly WireToolDefinition[];
}

/** What one search did, as the model reads it. */
export interface DeferredSearchOutcome {
  readonly loaded: readonly { readonly name: string; readonly description: string }[];
  readonly stillDeferred: readonly { readonly name: string; readonly summary: string }[];
  readonly catalogVersion?: number;
}
