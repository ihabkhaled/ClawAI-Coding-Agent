import { parseHostRules } from './http-host-rules';
import { createHttpTool } from './http-tool';
import { httpToolDefinition } from './http-tool-definition';

import type { HttpTool } from './http-tool.types';
import type { AgentPermissions } from './workspace-toolkit.types';

/** The HTTP tool and its definition for these permissions, or none when no host is allowed. */
export function httpToolPart(permissions: AgentPermissions): {
  readonly tool: HttpTool | undefined;
  readonly definitions: readonly unknown[];
} {
  const rules = parseHostRules(permissions.httpAllowHosts ?? []);
  if (typeof rules === 'string') throw new Error(rules);
  if (rules.length === 0) return { tool: undefined, definitions: [] };
  const granted = permissions.allow.some(
    (category) => category === 'http' || category === 'http-write',
  );
  return {
    tool: createHttpTool({ rules }),
    definitions: granted || permissions.offerRefused === true ? [httpToolDefinition(rules)] : [],
  };
}
