import type { AgentRunSnapshot } from '../core/agent-run';

/** What a run terminal needs from the extension, and nothing more. */
export interface AgentTerminalPort {
  /** Starts a run and resolves once it has been queued, not once it is done. */
  runAgent(input: { content: string; contextMode: 'workspace'; requestId: string }): Promise<void>;
  cancel(requestId: string): Promise<void>;
}

/** The run snapshots the terminal is watching, keyed by request. */
export interface AgentTerminalStatePort {
  subscribe(listener: (runs: Record<string, AgentRunSnapshot>) => void): () => void;
  currentRuns(): Record<string, AgentRunSnapshot>;
}
