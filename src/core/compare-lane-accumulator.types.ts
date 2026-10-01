import type { CompareVerdict } from './compare-verdict.types';

export interface CompareLaneState {
  content: string;
  errorMessage: string | null;
  inputTokens: number | null;
  model: string;
  outputTokens: number | null;
  provider: string;
  status: 'completed' | 'failed';
}

/** Where one lane is in its run, in the order a healthy lane passes through them. */
export type CompareLanePhase = 'connecting' | 'thinking' | 'generating' | 'finishing' | 'failed';

/**
 * What one stream event changed on one lane. Carries the new text only, never
 * the model's private reasoning: a lane that is thinking is a phase, not text.
 */
export interface CompareLaneUpdate {
  delta: string;
  elapsedMs: number | null;
  errorMessage: string | null;
  inputTokens: number | null;
  laneId: string;
  model: string;
  outputTokens: number | null;
  phase: CompareLanePhase;
  provider: string;
}

/** A change a live Compare card can show before the run has ended. */
export type CompareLiveChange =
  | { kind: 'lane'; lane: CompareLaneUpdate }
  | { kind: 'judge-ranking'; judgeModel: string | null }
  | { kind: 'judge-verdict'; verdict: CompareVerdict | null };
