import { z } from 'zod';

import { globMatches } from '../glob-match';

import type { McpAdmission, McpPolicySource, McpServerConfig, McpServerRefusal } from './mcp.types';

/**
 * One server pattern. `*` globs only, for the same reason project rules use
 * them: the list may come from an untrusted file, and a glob compiled from an
 * escaped literal cannot backtrack catastrophically.
 */
export const mcpServerPatternSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    /** Matched against the command and its arguments, joined by spaces. */
    command: z.string().min(1).max(1_000).optional(),
    url: z.string().min(1).max(2_048).optional(),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict()
  .refine(
    (pattern) =>
      pattern.name !== undefined || pattern.command !== undefined || pattern.url !== undefined,
    'An MCP server pattern must match on at least one of name, command or url',
  );

/**
 * Deny wins. A non-empty allowlist admits only the servers it matches; an
 * empty one admits every server, the same convention `allowedTools` uses.
 */
export const mcpServerPolicySchema = z
  .object({
    allow: z.array(mcpServerPatternSchema).max(200).default([]),
    deny: z.array(mcpServerPatternSchema).max(200).default([]),
  })
  .strict();

export type McpServerPattern = z.infer<typeof mcpServerPatternSchema>;
export type McpServerPolicy = z.infer<typeof mcpServerPolicySchema>;

function serverCommand(server: McpServerConfig): string | undefined {
  return server.transport === 'stdio' ? [server.command, ...server.args].join(' ') : undefined;
}

/** Every field the pattern names must match; a field a server lacks never matches. */
export function mcpServerMatches(pattern: McpServerPattern, server: McpServerConfig): boolean {
  if (pattern.name !== undefined && !globMatches(pattern.name, server.name)) return false;
  if (pattern.command !== undefined) {
    const command = serverCommand(server);
    if (command === undefined || !globMatches(pattern.command, command)) return false;
  }
  if (pattern.url !== undefined) {
    if (server.transport !== 'http' || !globMatches(pattern.url, server.url)) return false;
  }
  return true;
}

function policyRefusal(
  server: McpServerConfig,
  policy: McpServerPolicy | undefined,
  source: McpPolicySource,
): McpServerRefusal | undefined {
  if (policy === undefined) return undefined;
  const denied = policy.deny.find((pattern) => mcpServerMatches(pattern, server));
  if (denied !== undefined) {
    return {
      name: server.name,
      code: 'MCP_SERVER_DENIED',
      source,
      reason: denied.reason ?? `The ${source} policy denies this MCP server.`,
    };
  }
  if (policy.allow.length === 0) return undefined;
  if (policy.allow.some((pattern) => mcpServerMatches(pattern, server))) return undefined;
  return {
    name: server.name,
    code: 'MCP_SERVER_NOT_ALLOWED',
    source,
    reason: `The ${source} policy allows only listed MCP servers, and this one is not listed.`,
  };
}

/**
 * Parses an MCP policy block, treating a malformed one as deny-everything
 * rather than as absent. A policy that failed to parse was still somebody's
 * intent to restrict; reading it as "no policy" would invert it.
 */
export function readMcpServerPolicy(candidate: unknown): McpServerPolicy | undefined {
  if (candidate === undefined || candidate === null) return undefined;
  const parsed = mcpServerPolicySchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  return { allow: [], deny: [{ name: '*', reason: 'The MCP server policy could not be read.' }] };
}

/**
 * Decides which servers may start. Refused servers are reported and never
 * started. Organization deny is checked before project deny so the report
 * names the stricter authority, but either one refuses.
 */
export function admitMcpServers(
  servers: readonly McpServerConfig[],
  policies: { organization?: McpServerPolicy; project?: McpServerPolicy },
  workspaceTrusted: boolean,
): McpAdmission {
  const admitted: McpServerConfig[] = [];
  const refused: McpServerRefusal[] = [];
  for (const server of servers) {
    const refusal =
      policyRefusal(server, policies.organization, 'organization') ??
      policyRefusal(server, policies.project, 'project') ??
      trustRefusal(server, workspaceTrusted);
    if (refusal === undefined) admitted.push(server);
    else refused.push(refusal);
  }
  return { admitted, refused };
}

/** A stdio server is a process the extension launches; that needs a trusted workspace. */
function trustRefusal(
  server: McpServerConfig,
  workspaceTrusted: boolean,
): McpServerRefusal | undefined {
  if (server.transport !== 'stdio' || workspaceTrusted) return undefined;
  return {
    name: server.name,
    code: 'MCP_WORKSPACE_UNTRUSTED',
    reason: 'Local MCP servers run only in a trusted workspace.',
  };
}
