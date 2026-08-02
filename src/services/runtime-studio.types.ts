import type { RuntimeEvent } from '../core/runtime/runtime-protocol.schemas';

export interface RuntimeStudioInput {
  readonly prompt: string;
  readonly threadId: string;
  readonly requestId: string;
  readonly provider?: string;
  readonly model?: string;
  readonly signal: AbortSignal;
  readonly onEvent: (event: RuntimeEvent) => void;
}
