/**
 * One completion check, supplied by the orchestrator (the human or CI that
 * starts the run), never by the model. It runs without a shell, so the caller
 * writes the executable and its arguments separately.
 */
export interface DoneCheck {
  /** Names the check in events, results and the continuation prompt. */
  readonly label: string;
  readonly executable: string;
  readonly args: readonly string[];
  /** Relative to the workspace root, and contained in it. Default: the root. */
  readonly cwd?: string | undefined;
  /** Default 600,000; at most 3,600,000. The check is killed, with its children, when it is reached. */
  readonly timeoutMs?: number | undefined;
}

/** What one check did. `output` is redacted and never part of an event. */
export interface DoneCheckOutcome {
  readonly label: string;
  readonly ok: boolean;
  /** -1 when the check did not exit: timed out, cancelled, or never started. */
  readonly exitCode: number;
  readonly durationMs: number;
  readonly output: string;
}

/** Every check that ran, in order. */
export interface DoneChecksReport {
  readonly passed: boolean;
  readonly checks: readonly DoneCheckOutcome[];
}

/** The part of a check's outcome a result carries. */
export interface DoneCheckSummary {
  readonly label: string;
  readonly ok: boolean;
  readonly exitCode: number;
}

/** Runs the configured checks; the signal stops the one in flight. */
export type DoneCheckRunner = (signal: AbortSignal | undefined) => Promise<DoneChecksReport>;
