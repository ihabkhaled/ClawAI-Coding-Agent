export type CompareVerdictStatus = 'ranked' | 'unavailable' | 'skipped';

/** One lane's place in the judge's ranking. `laneIndex` is the request's model order, not the stream's. */
export interface CompareVerdictLane {
  label: string;
  laneIndex: number;
  model: string;
  provider: string;
  rank: number;
  reason: string;
  score: number;
}

/**
 * The one comparative verdict a Compare run stores on every lane message
 * (`metadata.compareJudge`). Only what a card shows is kept.
 */
export interface CompareVerdict {
  judgeModel: string;
  lanes: CompareVerdictLane[];
  rationale: string | null;
  scale: { max: number; min: number };
  status: CompareVerdictStatus;
  tiedLaneIndices: number[];
  winnerLaneIndex: number | null;
}
