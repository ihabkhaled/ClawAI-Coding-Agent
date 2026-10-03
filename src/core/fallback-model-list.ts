import { splitModelReference } from './runner-prompt-policy';

/** One fallback model: a bare model keeps the run's provider. */
export interface FallbackModel {
  readonly provider?: string | undefined;
  readonly model: string;
}

/**
 * Reads a fallback list: entries are `PROVIDER/model` or a bare model, and an
 * entry may itself be a comma list (`--fallback-model a,b`, `CLAW_FALLBACK_MODELS`).
 * Blank entries are dropped, so an empty setting means no fallback.
 */
export function parseFallbackModels(entries: readonly string[] | undefined): FallbackModel[] {
  const parsed: FallbackModel[] = [];
  for (const entry of entries ?? []) {
    for (const part of entry.split(',')) {
      const { provider, model } = splitModelReference(part);
      if (model !== undefined) parsed.push({ provider, model });
    }
  }
  return parsed;
}
