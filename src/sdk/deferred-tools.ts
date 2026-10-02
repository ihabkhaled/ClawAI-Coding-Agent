import { canonicalJson, sha256 } from '../headless/headless-transport';

import {
  DEFAULT_DEFERRED_TOOLS,
  DEFERRED_SEARCH_MAX_MATCHES,
  DEFERRED_SEARCH_MIN_TERM,
  DEFERRED_TOOL_SEARCH_DESCRIPTION,
  DEFERRED_TOOL_SEARCH_NAME,
  DEFERRED_TOOL_SUMMARIES,
} from './deferred-tools.constants';

import type { DeferredCatalog, WireToolDefinition } from './deferred-tools.types';

function isWire(definition: unknown): definition is WireToolDefinition {
  return (
    typeof definition === 'object' &&
    definition !== null &&
    'name' in definition &&
    typeof definition.name === 'string' &&
    'version' in definition &&
    typeof definition.version === 'string' &&
    'description' in definition &&
    typeof definition.description === 'string' &&
    'operations' in definition &&
    Array.isArray(definition.operations)
  );
}

/**
 * The commitment a stub carries: sha256 of the canonical JSON of the full
 * definition, which is what the backend recomputes when the definition is
 * loaded. The backend trims `description` when it parses a definition, so the
 * hash is taken over the trimmed form too.
 */
export function deferredDefinitionHash(definition: WireToolDefinition): string {
  return sha256(canonicalJson({ ...definition, description: definition.description.trim() }));
}

function firstSentence(description: string): string {
  return /^.*?[.!?](?=\s|$)/u.exec(description)?.[0] ?? description;
}

/** One line the model reads in place of the full definition. */
export function stubSummary(definition: WireToolDefinition): string {
  return DEFERRED_TOOL_SUMMARIES[definition.name] ?? firstSentence(definition.description);
}

/** Keys in the backend schema's order, `deferred` last, so the start catalog hash agrees. */
function stubOf(definition: WireToolDefinition): unknown {
  return {
    schemaVersion: definition.schemaVersion,
    name: definition.name,
    version: definition.version,
    description: stubSummary(definition),
    operations: definition.operations,
    riskClasses: definition.riskClasses,
    targetIds: definition.targetIds,
    inputSchema: { type: 'object' },
    deferred: { definitionHash: deferredDefinitionHash(definition) },
  };
}

/** The search tool, as a definition. */
export const DEFERRED_TOOL_SEARCH_DEFINITION = {
  schemaVersion: '2.0',
  name: DEFERRED_TOOL_SEARCH_NAME,
  version: '1.0.0',
  description: DEFERRED_TOOL_SEARCH_DESCRIPTION,
  operations: ['search'],
  riskClasses: ['inspect'],
  targetIds: ['target:workspace'],
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
} as const;

/**
 * Splits the offered catalog into what the run starts with and what waits for a
 * search. A catalog with nothing to defer is returned whole and WITHOUT the
 * search tool, so the model is never offered a tool that can only say "nothing
 * to find".
 */
export function splitCatalog(
  definitions: readonly unknown[],
  names: readonly string[] = DEFAULT_DEFERRED_TOOLS,
): DeferredCatalog {
  const chosen = new Set(names);
  const deferred = definitions.filter(isWire).filter((definition) => chosen.has(definition.name));
  if (deferred.length === 0) return { wire: definitions, deferred: [] };
  const wire = definitions.map((definition) =>
    isWire(definition) && chosen.has(definition.name) ? stubOf(definition) : definition,
  );
  return { wire: [...wire, DEFERRED_TOOL_SEARCH_DEFINITION], deferred };
}

/** Deferred definitions a query matches: an exact name wins, else keywords over name and description. */
export function searchDeferred(
  query: string,
  pending: readonly WireToolDefinition[],
): readonly WireToolDefinition[] {
  const normalized = query.trim().toLowerCase();
  const exact = pending.filter((definition) => definition.name === normalized);
  if (exact.length > 0) return exact;
  const terms = normalized
    .split(/[\s,]+/u)
    .filter((term) => term.length >= DEFERRED_SEARCH_MIN_TERM);
  return pending
    .filter((definition) => {
      const haystack = `${definition.name} ${stubSummary(definition)}`.toLowerCase();
      return terms.some((term) => haystack.includes(term));
    })
    .slice(0, DEFERRED_SEARCH_MAX_MATCHES);
}
