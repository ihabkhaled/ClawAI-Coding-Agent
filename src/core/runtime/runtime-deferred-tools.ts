import { createHash } from 'node:crypto';

import {
  DEFERRED_RUNTIME_TOOL_NAMES,
  DEFERRED_STUB_DESCRIPTION_CHARACTERS,
  TOOL_SEARCH_MAX_MATCHES,
  TOOL_SEARCH_TOOL_NAME,
} from './runtime-deferred-tools.constants';
import { parseToolDefinition } from './runtime-tool-contracts';
import { canonicalJson } from './runtime-tool-result';

import type { DeferredRuntimeCatalog, WireToolDefinition } from './runtime-deferred-tools.types';
import type { ToolDefinition } from './runtime-tool-contracts';

/**
 * The commitment a stub carries. Matches `deferredDefinitionHash` in the
 * chat-service: sha256 over the canonical JSON of the parsed full definition.
 */
export function deferredDefinitionHash(definition: ToolDefinition): string {
  const canonical = canonicalJson(parseToolDefinition(definition));
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function stubDescription(description: string): string {
  const firstSentence = /^.*?[.!?](?=\s|$)/u.exec(description)?.[0] ?? description;
  return firstSentence.slice(0, DEFERRED_STUB_DESCRIPTION_CHARACTERS).trim();
}

/** Keys in the backend schema's order, `deferred` last, so the catalog hash agrees. */
function stubOf(definition: ToolDefinition): WireToolDefinition {
  return {
    schemaVersion: definition.schemaVersion,
    name: definition.name,
    version: definition.version,
    description: stubDescription(definition.description),
    operations: definition.operations,
    riskClasses: definition.riskClasses,
    targetIds: definition.targetIds,
    inputSchema: { type: 'object' },
    deferred: { definitionHash: deferredDefinitionHash(definition) },
  };
}

/**
 * Splits the offered catalog into what the run starts with and what waits for
 * a search.
 *
 * Deferral needs the search tool itself: a catalog that does not offer
 * `runtime.tool_search` (a sub-agent's, say) is sent whole. A catalog with
 * nothing to defer drops the search tool, so the model is never offered a tool
 * that can only answer "nothing to find".
 */
export function deferRuntimeCatalog(
  definitions: readonly ToolDefinition[],
  deferrable: ReadonlySet<string> = DEFERRED_RUNTIME_TOOL_NAMES,
): DeferredRuntimeCatalog {
  const offersSearch = definitions.some((definition) => definition.name === TOOL_SEARCH_TOOL_NAME);
  const deferred = offersSearch
    ? definitions.filter((definition) => deferrable.has(definition.name))
    : [];
  if (deferred.length === 0) return { wire: withoutSearch(definitions), deferred: [] };
  return {
    wire: definitions.map((definition) =>
      deferrable.has(definition.name) ? stubOf(definition) : definition,
    ),
    deferred,
  };
}

/** The whole catalog without the search tool: the fallback when deferral is off. */
export function withoutSearch(definitions: readonly ToolDefinition[]): readonly ToolDefinition[] {
  return definitions.filter((definition) => definition.name !== TOOL_SEARCH_TOOL_NAME);
}

function matches(definition: ToolDefinition, terms: readonly string[]): boolean {
  const haystack = `${definition.name} ${definition.description}`.toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

/** Deferred tools matching a query by name or description, exact name first. */
export function searchDeferredTools(
  query: string,
  deferred: readonly ToolDefinition[],
): readonly ToolDefinition[] {
  const normalized = query.trim().toLowerCase();
  const exact = deferred.filter((definition) => definition.name === normalized);
  if (exact.length > 0) return exact;
  const terms = normalized.split(/[\s,]+/u).filter((term) => term.length >= 3);
  return deferred
    .filter((definition) => matches(definition, terms))
    .slice(0, TOOL_SEARCH_MAX_MATCHES);
}
