/** One representation of a cell output, decoded to text where it is text. */
export interface NotebookOutputItem {
  readonly mime: string;
  readonly bytes: Uint8Array;
}

/** What one executed cell reported, already bounded and redacted. */
export interface NotebookCellRun {
  readonly index: number;
  readonly executionOrder: number | null;
  readonly success: boolean | null;
  readonly output: string;
  readonly truncated: boolean;
}

export interface NotebookKernelRequest {
  readonly rootKey: string;
  readonly path: string;
  /** Absent means every cell. */
  readonly index?: number | undefined;
  readonly kernelId?: string | undefined;
  readonly timeoutMs: number;
}

export type NotebookRunResult =
  | { readonly status: 'unavailable'; readonly reason: string }
  | {
      readonly status: 'completed' | 'timed-out';
      readonly cells: readonly NotebookCellRun[];
      /** Set when the run did not finish, so the model can say why. */
      readonly note?: string | undefined;
    };
