/** A context window split between the prompt and the answer it needs room for. */
export interface ContextBudget {
  capacity: number;
  reserved: number;
  availableForPrompt: number;
}

/** How likely a send is to lose part of the conversation. */
export type TruncationRisk = 'none' | 'over' | 'tight' | 'unknown';
