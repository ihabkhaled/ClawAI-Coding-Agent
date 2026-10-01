import { z } from 'zod';

import { compareVerdictSchema } from '../core/compare-verdict';
import { COMPARE_VERDICT_MAX_NAME } from '../core/compare-verdict.constants';

import {
  COMPARE_LANE_ID_MAX,
  COMPARE_LANE_TEXT_MAX,
  COMPARE_MESSAGE_ERROR_MAX,
} from './chat-compare-message.constants';

import type { CompareLiveMessage } from './chat-compare-message.types';
import type { CompareLiveChange } from '../core/compare-lane-accumulator.types';

const name = z.string().max(COMPARE_VERDICT_MAX_NAME);
const tokens = z.number().int().min(0).nullable();

const compareLaneSchema = z.object({
  lane: z.object({
    delta: z.string().max(COMPARE_LANE_TEXT_MAX),
    elapsedMs: z.number().int().min(0).nullable(),
    errorMessage: z.string().max(COMPARE_MESSAGE_ERROR_MAX).nullable(),
    inputTokens: tokens,
    laneId: z.string().min(1).max(COMPARE_LANE_ID_MAX),
    model: name,
    outputTokens: tokens,
    phase: z.enum(['connecting', 'thinking', 'generating', 'finishing', 'failed']),
    provider: name,
  }),
  requestId: z.uuid(),
  type: z.literal('compareLane'),
});

const compareJudgeSchema = z.discriminatedUnion('phase', [
  z.object({
    judgeModel: name.nullable(),
    phase: z.literal('ranking'),
    requestId: z.uuid(),
    type: z.literal('compareJudge'),
  }),
  z.object({
    phase: z.literal('verdict'),
    requestId: z.uuid(),
    type: z.literal('compareJudge'),
    verdict: compareVerdictSchema.nullable(),
  }),
]);

/**
 * The messages the panel receives for a Compare run that is still going. Every
 * one is checked before it is posted, so a malformed lane update is dropped on
 * the host side rather than becoming a half-drawn card.
 */
export const compareLiveMessageSchema = z.union([compareLaneSchema, compareJudgeSchema]);

/** Maps a change the collector reports to the message the panel renders, or null when it is malformed. */
export function toCompareLiveMessage(
  change: CompareLiveChange,
  requestId: string,
): CompareLiveMessage | null {
  const parsed = compareLiveMessageSchema.safeParse(toCandidate(change, requestId));
  return parsed.success ? parsed.data : null;
}

function toCandidate(change: CompareLiveChange, requestId: string): unknown {
  if (change.kind === 'lane') {
    return { lane: change.lane, requestId, type: 'compareLane' };
  }
  if (change.kind === 'judge-ranking') {
    return { judgeModel: change.judgeModel, phase: 'ranking', requestId, type: 'compareJudge' };
  }
  return { phase: 'verdict', requestId, type: 'compareJudge', verdict: change.verdict };
}
