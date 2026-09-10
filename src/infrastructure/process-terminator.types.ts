/** Control over a termination sequence that is already under way. */
export interface ProcessTerminationHandle {
  /** Cancels any pending escalation, once the process has actually gone. */
  readonly settle: () => void;
  /** Whether the process had to be killed rather than asked to stop. */
  readonly wasForced: () => boolean;
}
