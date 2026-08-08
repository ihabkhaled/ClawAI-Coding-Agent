import type { RuntimeEvent } from '../core/runtime/runtime-protocol.schemas';
import type { Continuation, ToolInvocation } from '../core/runtime/runtime-tool-contracts';

export type RuntimeStreamObserver = {
  readonly onEvent: (event: RuntimeEvent) => void | Promise<void>;
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
