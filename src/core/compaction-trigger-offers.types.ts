/** An inline compaction offer put in front of the user and not yet answered. */
export interface PendingCompactionOffer {
  readonly requestId: string;
  readonly threadId: string;
}

/** What the host asks the panel to show. */
export interface CompactionOffer extends PendingCompactionOffer {
  /** Whole percent of the prompt allowance already used, 0 to 100. */
  readonly usedPercent: number;
}
