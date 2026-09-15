/** The shape of a `tool.requested` payload, as far as this runner needs it. */
export interface ToolRequestPayload {
  readonly invocationId?: string;
  readonly operation?: string;
  readonly toolName?: string;
  readonly invocation?: { readonly arguments?: Record<string, unknown> };
}

/** The boundaries a headless tool call must stay inside. */
export interface ToolLimits {
  readonly workspace: string;
  readonly allowedExecutables: readonly string[];
}
