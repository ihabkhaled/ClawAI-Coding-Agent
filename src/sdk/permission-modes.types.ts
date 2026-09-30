/**
 * How much a run may do without asking.
 *
 * - `plan` — read and git only; nothing is changed and nothing is asked.
 * - `ask` — every write, command and MCP tool call goes to the approval callback.
 * - `accept-edits` — file writes are accepted; commands and MCP tool calls are asked.
 *
 * A call that needs approval and has no callback to ask is denied, never allowed.
 */
export type AgentPermissionMode = 'plan' | 'ask' | 'accept-edits';
