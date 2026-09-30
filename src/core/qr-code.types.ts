/** A finished QR symbol: `modules[row][column]` is true for a dark module. */
export interface QrMatrix {
  readonly version: number;
  readonly size: number;
  readonly mask: number;
  readonly modules: readonly (readonly boolean[])[];
}

/** A symbol under construction, with the function-pattern map the mask must skip. */
export interface QrGrid {
  readonly version: number;
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];
}

export interface QrSvgOptions {
  /** Read aloud by assistive tech. Already translated by the caller. */
  readonly label: string;
}
