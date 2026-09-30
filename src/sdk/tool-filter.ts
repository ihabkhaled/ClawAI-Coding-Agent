import { globMatches } from '../core/glob-match';

import type { AgentToolCall } from './agent-sdk.types';
import type { AgentToolFilter } from './tool-filter.types';

const MCP_TOOL = 'runtime.mcp';

/**
 * The identifiers a call answers to; a deny on any one of them refuses it.
 *
 * Besides `tool.operation` a call answers to the bare tool name, so
 * `workspace.file` denies (or allows) every operation of that tool and does not
 * silently match nothing.
 */
export function toolIdentifiers(call: AgentToolCall): readonly string[] {
  if (call.toolName !== MCP_TOOL) return [`${call.toolName}.${call.operation}`, call.toolName];
  const server = call.arguments.server;
  const name = call.arguments.tool;
  if (call.operation === 'call' && typeof server === 'string' && typeof name === 'string') {
    return [`mcp__${server}__${name}`];
  }
  if (call.operation === 'tools' && typeof server === 'string') {
    return [`${MCP_TOOL}.tools`, `mcp__${server}`, `mcp__${server}__*`];
  }
  return [`${MCP_TOOL}.${call.operation}`];
}

function anyMatch(patterns: readonly string[], identifiers: readonly string[]): boolean {
  return patterns.some((pattern) => identifiers.some((id) => globMatches(pattern, id)));
}

/**
 * Whether the filter lets this call through.
 *
 * MCP discovery (`servers`, `tools`) is not a tool call the operator names, so
 * an allow list that names any MCP tool admits it; the deny list still applies.
 */
export function toolPermitted(filter: AgentToolFilter, call: AgentToolCall): boolean {
  const identifiers = toolIdentifiers(call);
  if (anyMatch(filter.deny ?? [], identifiers)) return false;
  const allow = filter.allow ?? [];
  if (allow.length === 0 || anyMatch(allow, identifiers)) return true;
  const discovery = call.toolName === MCP_TOOL && call.operation !== 'call';
  return discovery && allow.some((pattern) => pattern.startsWith('mcp__'));
}
