/** The workspace paths a mention may name. */
export interface MentionIndexPort {
  paths(): Promise<readonly string[]>;
}

/** Paths to offer, and the span in the composer text the chosen one replaces. */
export interface MentionSuggestions {
  /** Index of the `@`, or -1 when the caret is not inside a mention. */
  start: number;
  /** Index just past the typed query, or -1. */
  end: number;
  paths: string[];
}
