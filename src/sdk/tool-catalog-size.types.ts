/** The size of one tool definition as it is sent to the model, every turn. */
export interface ToolSize {
  readonly name: string;
  readonly operations: number;
  /** Characters of the whole definition, serialized as the run start sends it. */
  readonly chars: number;
  readonly descriptionChars: number;
  readonly operationsChars: number;
  readonly schemaChars: number;
  /** Approximate tokens (see `estimateTokens`). */
  readonly tokens: number;
}

/** A named set of tool definitions: what one grant combination offers. */
export interface CatalogScenario {
  readonly label: string;
  readonly definitions: readonly unknown[];
}

/** The whole catalog's size for one scenario. */
export interface CatalogSize {
  readonly label: string;
  readonly tools: readonly ToolSize[];
  readonly chars: number;
  readonly tokens: number;
}
