import { z } from 'zod';

import type { PolicyRequest, PolicySubject } from '../policy-v2';

type McpClassification = Pick<PolicyRequest, 'effect' | 'risk' | 'reversible'>;

/**
 * How `runtime.mcp` operations are classified.
 *
 * `servers` only reads configuration and starts nothing. `tools` starts or
 * connects to a server — a local process or a remote endpoint running code the
 * extension did not write — and `call` asks that code to act. Both are R3, so
 * every mode short of an explicit project deny asks the user first, per call.
 */
export function classifyMcpOperation(operation: string): McpClassification {
  if (operation === 'servers') return { effect: 'read', risk: 'R0', reversible: true };
  if (operation === 'tools') return { effect: 'local-mutation', risk: 'R3', reversible: false };
  return { effect: 'network-write', risk: 'R3', reversible: false };
}

const mcpSubjectArgumentsSchema = z
  .object({
    server: z.string().min(1).max(200).optional(),
    tool: z.string().min(1).max(200).optional(),
  })
  .loose();

/**
 * The subject a project rule matches for an MCP call: `mcp <server> <tool>` as
 * the command, so `commandGlob: "mcp github *"` targets one server's tools.
 */
export function mcpPolicySubject(
  operation: string,
  toolName: string,
  argumentsCandidate: unknown,
): PolicySubject {
  const parsed = mcpSubjectArgumentsSchema.safeParse(argumentsCandidate);
  const parts = parsed.success
    ? ['mcp', parsed.data.server, parsed.data.tool].filter((part) => part !== undefined)
    : ['mcp'];
  return { tool: toolName, operation, paths: [], domains: [], command: parts.join(' ') };
}
