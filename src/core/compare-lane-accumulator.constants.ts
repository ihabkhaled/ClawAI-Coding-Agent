import type { CompareLanePhase } from './compare-lane-accumulator.types';

/**
 * The server's lane lifecycle stages, as a card names them. A stage not listed
 * (queued, retrieving context, research) leaves the lane where it was.
 */
export const COMPARE_STAGE_PHASES: Readonly<Record<string, CompareLanePhase>> = {
  authenticating: 'connecting',
  connecting_provider: 'connecting',
  finalizing: 'finishing',
  generating: 'generating',
  thinking: 'thinking',
  tool_calling: 'thinking',
  waiting_first_token: 'connecting',
};

/** A lane only moves forward: a late thinking frame after the first token is not a step back. */
export const COMPARE_PHASE_ORDER: Readonly<Record<CompareLanePhase, number>> = {
  connecting: 0,
  failed: 4,
  finishing: 3,
  generating: 2,
  thinking: 1,
};

/** The server's final metrics frame for a lane reports 96 percent and the stage timings. */
export const COMPARE_FINISHING_PERCENT = 96;

/** The orchestration stage the one comparative judge call runs under. */
export const COMPARE_JUDGE_STAGE_PREFIX = 'compare-judge:';
