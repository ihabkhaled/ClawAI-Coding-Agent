/** The mention token the caret sits inside, located in the composer text. */
export interface MentionQuery {
  /** Index of the `@`. */
  start: number;
  /** Index just past the last character typed, which is the caret. */
  end: number;
  /** What was typed after the `@`. */
  query: string;
}

/** A workspace path offered for a mention, with where the query matched it. */
export interface MentionMatch {
  path: string;
  score: number;
  positions: number[];
}
