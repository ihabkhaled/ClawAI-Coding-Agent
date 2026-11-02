import type { ModelCatalogEntry, ModelCostBand } from './model-catalog';

/** The part of a backend access answer the picker reads. */
export interface ModelAccessHint {
  readonly provider: string;
  readonly model: string;
  readonly allowed: boolean;
  readonly costClass?: ModelCostBand | undefined;
  readonly coveredByAllowance?: boolean | undefined;
}

/**
 * Adds the cost band and availability hints to the catalog.
 *
 * Only a field the backend actually sent is copied, so a model with no answer
 * (or an answer without a band) is left exactly as it was: no mark, no dim.
 * The entries are matched on `provider:model`, the same key the picker uses.
 */
export function mergeModelAccess(
  catalog: readonly ModelCatalogEntry[],
  hints: readonly ModelAccessHint[],
): ModelCatalogEntry[] {
  if (hints.length === 0) return [...catalog];
  const byKey = new Map(hints.map((hint) => [`${hint.provider}:${hint.model}`, hint] as const));
  return catalog.map((entry) => {
    const hint = byKey.get(`${entry.provider}:${entry.model}`);
    if (hint === undefined) return entry;
    return {
      ...entry,
      allowed: hint.allowed,
      ...(hint.costClass === undefined ? {} : { costClass: hint.costClass }),
      ...(hint.coveredByAllowance === undefined
        ? {}
        : { coveredByAllowance: hint.coveredByAllowance }),
    };
  });
}

/** Whether the picker dims the entry: a hint only, selection rules are unchanged. */
export function isModelDimmed(entry: {
  readonly allowed?: boolean | undefined;
  readonly coveredByAllowance?: boolean | undefined;
}): boolean {
  return entry.allowed === false || entry.coveredByAllowance === false;
}

/** The models worth asking about: local runtimes cost nothing and the backend does not know them. */
export function accessQueries(
  catalog: readonly ModelCatalogEntry[],
): { provider: string; model: string }[] {
  return catalog
    .filter((entry) => !entry.isLocal)
    .map((entry) => ({ provider: entry.provider, model: entry.model }));
}
