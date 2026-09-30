/**
 * How much a run may do without asking.
 *
 * - `plan` — read and git only; nothing is changed and nothing is asked.
 * - `ask` — every write, command, git-write and MCP tool call goes to the approval callback.
 * - `accept-edits` — file writes are accepted; commands, git-write and MCP tool calls are asked.
 * - `autonomous-scoped` — the editor's Autonomous Scoped: edits and commands run; anything
 *   irreversible or reaching outside the machine (commit, push, delete, MCP call) is asked.
 * - `strict` — the editor's Strict: asked like `ask`, and delete-class changes are refused.
 *
 * A call that needs approval and has no callback to ask is denied, never allowed.
 */
export type AgentPermissionMode = 'plan' | 'ask' | 'accept-edits' | 'autonomous-scoped' | 'strict';
