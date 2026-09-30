/**
 * Glob lists over tool identifiers; `*` is the only wildcard. Deny wins, and an
 * empty allow list restricts nothing, the same convention the MCP policy uses.
 *
 * Identifiers are `workspace.file.read`, `workspace.command.run`,
 * `workspace.git.status`, `mcp__<server>__<tool>` for an MCP call,
 * `runtime.mcp.servers`, and `runtime.mcp.tools` (also as `mcp__<server>`).
 */
export interface AgentToolFilter {
  readonly allow?: readonly string[] | undefined;
  readonly deny?: readonly string[] | undefined;
}
