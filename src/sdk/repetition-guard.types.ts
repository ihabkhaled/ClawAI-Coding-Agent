import type { AgentToolkit } from './agent-sdk.types';
import type { StuckInfo } from '../core/repetition-guard.types';

export interface RepetitionGuard {
  /** The toolkit with every call watched. */
  readonly guard: (toolkit: AgentToolkit) => AgentToolkit;
  /** Set once the run has been declared stuck. */
  readonly stuck: () => StuckInfo | undefined;
}
