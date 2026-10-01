import type { CompareLanePhase } from '../core/compare-lane-accumulator.types';
import type { CompareVerdict } from '../core/compare-verdict.types';

/** One lane's card changed: its phase, the text it just wrote, or its usage. */
export interface CompareLaneMessage {
  lane: {
    delta: string;
    elapsedMs: number | null;
    errorMessage: string | null;
    inputTokens: number | null;
    laneId: string;
    model: string;
    outputTokens: number | null;
    phase: CompareLanePhase;
    provider: string;
  };
  requestId: string;
  type: 'compareLane';
}

/** The judge started ranking, or its verdict arrived (null when none was returned). */
export type CompareJudgeMessage =
  | { judgeModel: string | null; phase: 'ranking'; requestId: string; type: 'compareJudge' }
  | { phase: 'verdict'; requestId: string; type: 'compareJudge'; verdict: CompareVerdict | null };

export type CompareLiveMessage = CompareJudgeMessage | CompareLaneMessage;
