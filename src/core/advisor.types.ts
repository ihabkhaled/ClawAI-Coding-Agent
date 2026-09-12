/** The model chosen to give a second opinion, and why it was reachable. */
export interface AdvisorSelection {
  readonly key: string;
  readonly provider: string;
  readonly model: string;
  readonly displayName: string;
}

/** One piece of advice, with the provenance that makes it judgeable. */
export interface AdviceRecord {
  readonly advisor: string;
  readonly question: string;
  readonly advice: string;
  /** Advice is never a decision. Carried explicitly so no reader has to infer it. */
  readonly binding: false;
}
