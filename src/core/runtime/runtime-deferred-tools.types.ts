import type { ToolDefinition } from './runtime-tool-contracts';

/** A catalog entry as sent at run start: a full definition, or a deferred stub. */
export type WireToolDefinition = ToolDefinition & {
  readonly deferred?: { readonly definitionHash: string };
};

/** The start catalog split into what is sent and what waits for a search. */
export interface DeferredRuntimeCatalog {
  readonly wire: readonly WireToolDefinition[];
  readonly deferred: readonly ToolDefinition[];
}

/** What one `runtime.tool_search` call did: what it loaded and what is still deferred. */
export interface DeferredToolSearchOutcome {
  readonly loaded: readonly {
    readonly name: string;
    readonly version: string;
    readonly description: string;
  }[];
  readonly available: readonly string[];
  readonly catalogVersion?: number;
}

/** The transport seam the search tool reaches the running run through. */
export interface DeferredToolLoaderPort {
  loadDeferredTools(
    runId: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<DeferredToolSearchOutcome>;
}
