import {
  VISION_MAX_MODEL_ATTEMPTS,
  VISION_NOT_A_CHAT_MODEL,
  VISION_PREFERRED_MODELS,
} from './vision-tool.constants';

import type { VisionCatalogModel } from './vision-tool.types';

/** The message when the account has no model that can look at an image. */
export const VISION_NO_MODEL_MESSAGE =
  'No vision model is available to this account: no connector model is marked as accepting images. ' +
  'Ask the operator to enable one (for example an OpenAI, Anthropic, Gemini or Grok connector), or pass ' +
  '--vision-model <provider/model>. Without one this agent cannot look at screenshots; check the page by ' +
  'other means (page text, DOM, layout measurements).';

function suitable(model: VisionCatalogModel): boolean {
  return model.supportsVision && !VISION_NOT_A_CHAT_MODEL.test(model.modelKey);
}

function preferenceRank(model: VisionCatalogModel): number {
  const index = VISION_PREFERRED_MODELS.findIndex((name) => model.modelKey.endsWith(name));
  return index === -1 ? VISION_PREFERRED_MODELS.length : index;
}

function priceOf(model: VisionCatalogModel): number {
  return model.inputUsdPerMillion ?? Number.POSITIVE_INFINITY;
}

/**
 * The models to try, best first: the cheap, good-at-screenshots ones the
 * catalog lists, then the rest by price. At most `VISION_MAX_MODEL_ATTEMPTS`,
 * because a model that is out of credit must not turn one question into fifty
 * calls. Models in `skip` already failed in this run.
 */
export function visionCandidates(
  catalog: readonly VisionCatalogModel[],
  skip: ReadonlySet<string> = new Set(),
): readonly VisionCatalogModel[] {
  return catalog
    .filter((model) => suitable(model) && !skip.has(modelId(model)))
    .sort((a, b) => preferenceRank(a) - preferenceRank(b) || priceOf(a) - priceOf(b))
    .slice(0, VISION_MAX_MODEL_ATTEMPTS);
}

export function modelId(model: VisionCatalogModel): string {
  return `${model.provider}/${model.modelKey}`;
}

/**
 * The model `--vision-model` names: `provider/model` or a bare model key. An
 * unknown name or a model the catalog does not mark as vision is an error that
 * says so, never a quiet fallback to some other model.
 */
export function namedVisionModel(
  catalog: readonly VisionCatalogModel[],
  requested: string,
): VisionCatalogModel {
  const wanted = requested.trim().toLowerCase();
  const found = catalog.find(
    (model) => modelId(model).toLowerCase() === wanted || model.modelKey.toLowerCase() === wanted,
  );
  if (found === undefined) {
    throw new Error(
      `The vision model "${requested}" is not in this account's catalog. Use --list-models and give provider/model.`,
    );
  }
  if (!found.supportsVision) {
    throw new Error(`The vision model "${requested}" is not marked as accepting images.`);
  }
  return found;
}
