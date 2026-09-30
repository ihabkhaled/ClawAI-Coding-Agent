import type { BackgroundCommandPort } from './structured-command-tool-executor.types';
import type { CommandSandboxReport } from '../core/command-sandbox.types';
import type { ProcessIdentityReceipt } from '../services/process-supervisor-service';

/** Everything the yield wait needs once the command is already running. */
export interface CommandYieldRequest {
  readonly supervisor: BackgroundCommandPort['supervisor'];
  readonly receipt: ProcessIdentityReceipt;
  readonly yieldAfterMs: number;
  readonly outputLimitBytes: number;
  readonly startedAtMs: number;
  readonly signal?: AbortSignal;
  /** How the launch was confined, carried through so a yield reports it like a foreground run. */
  readonly sandbox?: CommandSandboxReport;
}

/** How the wait ended: the command exited, the window elapsed, or the turn was cancelled. */
export type CommandYieldOutcome = 'exited' | 'yielded' | 'cancelled';

/** The output tail handed back to the model, bounded by the caller's byte limit. */
export interface BoundedOutput {
  readonly output: string;
  readonly truncated: boolean;
}
