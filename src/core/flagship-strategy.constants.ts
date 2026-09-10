/**
 * Strategy names this repository suggests, kept as examples rather than limits.
 *
 * They were the whole of the permitted set until the list was found to
 * constrain nothing but the caller's vocabulary.
 */
export const FLAGSHIP_SUGGESTED_STRATEGIES: readonly string[] = [
  'cross-stack-feature',
  'incident-fix',
  'architecture-refactor',
  'mobile-web-backend',
  'prompt-pack-audit',
];

/**
 * A lowercase slug: letters and digits, single hyphens between them.
 *
 * Leading, trailing and doubled hyphens are refused so two spellings of the
 * same intent cannot hash to two different delivery identities.
 */
export const FLAGSHIP_STRATEGY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
