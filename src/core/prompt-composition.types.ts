import type { AgentMode } from './agent-mode.types';

/** Everything that shapes a prompt before it is sent. */
export interface PromptComposition {
  agentMode: AgentMode;
  /** The output style's instruction, or an empty string for no style. */
  stylePreamble: string;
  content: string;
}
