/**
 * What the panel is allowed to know about a model's private reasoning.
 *
 * Never the text. `deltaTokens` is the size of the reasoning segment that was
 * dropped, and `segments` counts how many arrived, so the disclosure row can
 * say "the model is thinking, and here is how much" without quoting a single
 * word of the chain of thought.
 */
export interface ReasoningStatus {
  tokens: number;
  segments: number;
}
