/** One place a multiline pattern matched, reported the way a line match is. */
export interface MultilineSearchMatch {
  /** 1-based line the match starts on. */
  readonly line: number;
  readonly preview: string;
}
