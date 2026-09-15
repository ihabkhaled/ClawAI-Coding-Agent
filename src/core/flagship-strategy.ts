import { z } from 'zod';

import {
  FLAGSHIP_STRATEGY_PATTERN,
  FLAGSHIP_SUGGESTED_STRATEGIES,
} from './flagship-strategy.constants';

/**
 * The name a delivery gives its own approach.
 *
 * This was a closed list of five: cross-stack feature, incident fix,
 * architecture refactor, mobile-web-backend, and prompt-pack audit. Nothing
 * branched on the value. It is carried into the request identity hash and shown
 * in reports, and that is all it has ever done — so a delivery whose approach
 * was a security hardening or a data migration was refused by a validator for a
 * field that is a label.
 *
 * Five names chosen by this repository cannot cover the deliveries people
 * actually run, and a closed list of labels turns a naming disagreement into a
 * validation failure. The list survives as a suggestion rather than a
 * constraint.
 *
 * It is a slug rather than free text because it is hashed. Free text would let
 * two identical deliveries differ by a capital letter or a trailing space and
 * produce different identities, which is exactly the collision the hash exists
 * to prevent.
 */
export const flagshipStrategySchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.string().min(3).max(60).regex(FLAGSHIP_STRATEGY_PATTERN));

export type FlagshipStrategy = z.output<typeof flagshipStrategySchema>;

/**
 * Whether this is one of the five the repository suggests.
 *
 * Kept so a caller can still tell a familiar strategy from a new one — for
 * grouping a report, say — without that distinction becoming a refusal.
 */
export function isSuggestedFlagshipStrategy(strategy: string): boolean {
  return FLAGSHIP_SUGGESTED_STRATEGIES.includes(strategy);
}
