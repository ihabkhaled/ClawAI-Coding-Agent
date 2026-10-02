import { TOKEN_ESTIMATE_CHARS_PER_TOKEN } from './tool-catalog-size.constants';

import type { CatalogScenario, CatalogSize, ToolSize } from './tool-catalog-size.types';

/**
 * Approximate tokens for a number of characters of tool-definition text.
 *
 * A fixed ratio, not a tokenizer: JSON schemas are punctuation-heavy and sit
 * near 3.5 characters per token. It is only good for comparing two catalogs,
 * which is all a budget needs.
 */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / TOKEN_ESTIMATE_CHARS_PER_TOKEN);
}

function fieldChars(definition: Readonly<Record<string, unknown>>, key: string): number {
  const value = definition[key];
  return value === undefined ? 0 : JSON.stringify(value).length;
}

/** The size of one definition, exactly as `JSON.stringify` puts it on the wire. */
export function measureDefinition(definition: unknown): ToolSize {
  const record: Readonly<Record<string, unknown>> =
    typeof definition === 'object' && definition !== null ? { ...definition } : {};
  const chars = JSON.stringify(definition).length;
  const { name, operations } = record;
  return {
    name: typeof name === 'string' ? name : '(unnamed)',
    operations: Array.isArray(operations) ? operations.length : 0,
    chars,
    descriptionChars: fieldChars(record, 'description'),
    operationsChars: fieldChars(record, 'operations'),
    schemaChars: fieldChars(record, 'inputSchema'),
    tokens: estimateTokens(chars),
  };
}

/** Per-tool and total sizes of one scenario's catalog. */
export function measureCatalog(scenario: CatalogScenario): CatalogSize {
  const tools = scenario.definitions.map(measureDefinition);
  // The catalog is sent as one JSON array, so brackets and commas count too.
  const chars = JSON.stringify(scenario.definitions).length;
  return { label: scenario.label, tools, chars, tokens: estimateTokens(chars) };
}

/** A plain-text table of a catalog, one row per tool. */
export function formatCatalog(size: CatalogSize): string {
  const rows = size.tools.map(
    (tool) =>
      `${tool.name.padEnd(18)} ${String(tool.operations).padStart(2)} ops ` +
      `${String(tool.chars).padStart(6)} chars (desc ${String(tool.descriptionChars).padStart(5)}, ` +
      `ops ${String(tool.operationsChars).padStart(4)}, schema ${String(tool.schemaChars).padStart(5)}) ` +
      `~${String(tool.tokens).padStart(5)} tok`,
  );
  const total = `TOTAL ${size.label}: ${String(size.chars)} chars, ~${String(size.tokens)} tokens`;
  return [`== ${size.label} ==`, ...rows, total].join('\n');
}
