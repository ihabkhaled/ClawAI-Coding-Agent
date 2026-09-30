import type { AgentToolCall } from './agent-sdk.types';

/** The kinds of work a run can be granted, one flag each; `mcp` is the configured MCP servers. */
export type AgentToolCategory = 'read' | 'write' | 'command' | 'git' | 'mcp';

/** One tool call awaiting the caller's decision, with the category it falls in. */
export interface AgentApprovalRequest extends AgentToolCall {
  readonly category: AgentToolCategory;
}

/**
 * What a run may do on the caller's machine.
 *
 * `allow` decides what the model is offered at all; `approve`, when given, is
 * asked once per call inside that set. Withholding a category and declining a
 * call both reach the model as `PERMISSION_DENIED`, never as a crash.
 */
export interface AgentPermissions {
  readonly allow: readonly AgentToolCategory[];
  /** Added to the default command allowlist (node, npm, npx). */
  readonly allowedExecutables?: readonly string[] | undefined;
  readonly approve?: ((request: AgentApprovalRequest) => boolean | Promise<boolean>) | undefined;
}
