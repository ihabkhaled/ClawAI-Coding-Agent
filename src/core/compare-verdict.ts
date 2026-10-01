import { z } from 'zod';

import {
  COMPARE_VERDICT_MAX_LANES,
  COMPARE_VERDICT_MAX_NAME,
  COMPARE_VERDICT_MAX_TEXT,
} from './compare-verdict.constants';

import type { CompareVerdict } from './compare-verdict.types';

const name = z.string().max(COMPARE_VERDICT_MAX_NAME);
const text = z.string().transform((value) => value.slice(0, COMPARE_VERDICT_MAX_TEXT));

export const compareVerdictSchema = z.object({
  judgeModel: name,
  lanes: z
    .array(
      z.object({
        label: name.default(''),
        laneIndex: z.number().int().min(0),
        model: name,
        provider: name,
        rank: z.number().int().min(1),
        reason: text.default(''),
        score: z.number(),
      }),
    )
    .max(COMPARE_VERDICT_MAX_LANES),
  rationale: text.nullable().default(null),
  scale: z.object({ max: z.number(), min: z.number() }),
  status: z.enum(['ranked', 'unavailable', 'skipped']),
  tiedLaneIndices: z.array(z.number().int().min(0)).max(COMPARE_VERDICT_MAX_LANES).default([]),
  winnerLaneIndex: z.number().int().min(0).nullable().default(null),
});

/** The verdict a server stored on a lane message, or null when it is absent or malformed. */
export function parseCompareVerdict(value: unknown): CompareVerdict | null {
  const parsed = compareVerdictSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Compare stores the same verdict on every lane message of a run, so the first
 * readable one is the run's verdict.
 */
export function compareVerdictFromMetadata(
  metadata: readonly (Record<string, unknown> | null | undefined)[],
): CompareVerdict | null {
  for (const entry of metadata) {
    const verdict = parseCompareVerdict(entry?.compareJudge);
    if (verdict !== null) {
      return verdict;
    }
  }
  return null;
}
