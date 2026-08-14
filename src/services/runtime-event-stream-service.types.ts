import type { RuntimeEvent } from '../core/runtime/runtime-protocol.schemas';
import type { Continuation, ToolInvocation } from '../core/runtime/runtime-tool-contracts';

export type RuntimeStreamObserver = {
  readonly onEvent: (event: RuntimeEvent) => void | Promise<void>;
  /**
   * A broken stream is being reopened from the last cursor.
   *
   * Optional because resuming is not the run's business — the run continues
   * either way. It exists so a reconnect leaves a trace: the previous
   * behaviour, failing outright, at least said something, and a silent
   * recovery that takes eight seconds should not look like a stall.
   */
  readonly onStreamResume?: (attempt: number, reason: unknown) => void;
};

export type RuntimeStreamRuntimePort = {
  beginModelTurn(repair: boolean, turnId: string): unknown;
  dispatch(invocation: ToolInvocation, continuation: Continuation): Promise<unknown>;
  /**
   * Whether the local run this stream belongs to is still open.
   *
   * A run can end on this side first — the user cancels, or denies a tool — and
   * the backend keeps streaming until it learns of it. Those late frames used
   * to be handed to `beginModelTurn`, which threw "No runtime run is active"
   * and put that internal sentence in front of the user as the answer.
   */
  hasActiveRun(): boolean;
};
