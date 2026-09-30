import type { AgentToolkit } from './agent-sdk.types';

/** How a call bears on the guard: a look, a note to self, or a change to the workspace. */
export type RepetitionCallKind = 'read' | 'note' | 'change';

/** A run that ended because it repeated one call without getting anywhere. */
export interface StuckInfo {
  readonly tool: string;
  readonly operation: string;
  /** How many times the call had been made when the run ended. */
  readonly times: number;
  /** The path, pattern or query it was about; empty when it had none. */
  readonly target: string;
}

/** One remembered call. `epoch` counts the workspace changes made before it. */
export interface RepetitionRecord {
  readonly key: string;
  readonly epoch: number;
}

export interface RepetitionGuardOptions {
  /** Told once, when the run is stuck; the caller ends the run. */
  readonly onStuck: (info: StuckInfo) => void;
}

export interface RepetitionGuard {
  /** The toolkit with every call watched. */
  readonly guard: (toolkit: AgentToolkit) => AgentToolkit;
  /** Set once the run has been declared stuck. */
  readonly stuck: () => StuckInfo | undefined;
}
