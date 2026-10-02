import { searchDeferred, stubSummary } from './deferred-tools';
import { DEFERRED_SEARCH_QUERY_CHARS, DEFERRED_TOOL_SEARCH_NAME } from './deferred-tools.constants';

import type { AgentToolCall, AgentToolkit } from './agent-sdk.types';
import type {
  DeferredCatalog,
  DeferredSearchOutcome,
  DeferredToolLoader,
  WireToolDefinition,
} from './deferred-tools.types';

/** Where the loader goes once the run exists; the toolkit is built before the run starts. */
export interface DeferredLoaderRef {
  current: DeferredToolLoader | undefined;
}

function isSearch(call: AgentToolCall): boolean {
  return call.toolName === DEFERRED_TOOL_SEARCH_NAME;
}

function queryOf(call: AgentToolCall): string {
  const { query } = call.arguments;
  if (call.operation !== 'search' || typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('runtime.tool_search needs search {query}: a tool name or keywords.');
  }
  return query.trim().slice(0, DEFERRED_SEARCH_QUERY_CHARS);
}

function remaining(pending: readonly WireToolDefinition[]): DeferredSearchOutcome['stillDeferred'] {
  return pending.map((definition) => ({ name: definition.name, summary: stubSummary(definition) }));
}

/**
 * One `runtime.tool_search`: loads what the query matches and reports what is
 * still deferred. It only ever asks for definitions this run offered, so a
 * search can add a schema to the catalog and can never add a right: the call the
 * model then makes still goes through the toolkit's own authorization.
 */
async function search(
  call: AgentToolCall,
  pending: WireToolDefinition[],
  loader: DeferredToolLoader | undefined,
  signal?: AbortSignal,
): Promise<DeferredSearchOutcome> {
  const query = queryOf(call);
  const matched = searchDeferred(query, pending);
  if (matched.length === 0) return { loaded: [], stillDeferred: remaining(pending) };
  if (loader === undefined) throw new Error('Deferred tools cannot be loaded for this run.');
  const ack = await loader(matched, signal);
  const admitted = new Set(ack.loaded.map((entry) => entry.name));
  const left = pending.filter((definition) => !admitted.has(definition.name));
  pending.splice(0, pending.length, ...left);
  return {
    loaded: matched
      .filter((definition) => admitted.has(definition.name))
      .map((definition) => ({ name: definition.name, description: definition.description })),
    stillDeferred: remaining(pending),
    catalogVersion: ack.catalogVersion,
  };
}

/**
 * The toolkit for a run that started with stubs. Offered definitions stay the
 * whole set (they are what unknown-tool errors and checks read); only the start
 * request carries stubs. A call to the search tool is answered here, everything
 * else goes to the inner toolkit untouched.
 */
export function deferredToolkit(
  inner: AgentToolkit,
  catalog: DeferredCatalog,
  loader: DeferredLoaderRef,
): AgentToolkit {
  const pending = [...catalog.deferred];
  return {
    definitions: inner.definitions,
    authorize: (call) =>
      isSearch(call) ? true : inner.authorize === undefined ? true : inner.authorize(call),
    execute: (call, signal) =>
      isSearch(call) ? search(call, pending, loader.current, signal) : inner.execute(call, signal),
    ...(inner.dispose === undefined ? {} : { dispose: inner.dispose }),
  };
}
