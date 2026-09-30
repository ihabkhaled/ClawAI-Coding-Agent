import { AGENT_SDK_DEFAULTS } from './agent-sdk.constants';
import { mcpToolkit } from './mcp-toolkit';
import { permissionsForMode } from './permission-modes';
import { combineToolkits, restrictToolkit } from './toolkit-compose';
import { httpWebResearch } from './web-research-http';
import { webToolkit } from './web-toolkit';
import { workspaceToolkit } from './workspace-toolkit';
import { AGENT_DEFAULT_TOOL_CATEGORIES } from './workspace-toolkit.constants';

import type { AgentToolkit } from './agent-sdk.types';
import type { AgentConfig } from './create-agent.types';
import type { AgentPermissions, WorkspaceMemory } from './workspace-toolkit.types';

/**
 * What a configured agent may do: the workspace tools, the MCP servers when
 * given, the web tools the research mode offers, the permission mode over the
 * local ones, and the allow and deny lists on top.
 *
 * Without `permissions`, the grant is read and git, plus `mcp` when servers
 * were configured — naming servers is the request to use them. Naming a
 * research mode is the same kind of request for the web tools, which are
 * reads and so are not asked about in any permission mode.
 *
 * `token` is read when a web call is made, because the run signs in after the
 * toolkit is built.
 */
export function agentToolkit(
  config: AgentConfig,
  memory?: WorkspaceMemory,
  token: () => string | undefined = () => undefined,
): AgentToolkit {
  const permissions = effectivePermissions(config);
  const workspace = workspaceToolkit(config.workspaceRoot, permissions, memory);
  const web =
    config.research === undefined
      ? undefined
      : webToolkit(
          config.research,
          config.webResearch ??
            httpWebResearch(config.backendUrl ?? AGENT_SDK_DEFAULTS.backendUrl, token),
        );
  const parts = [
    workspace,
    ...(config.mcp === undefined
      ? []
      : [mcpToolkit(config.mcp, config.workspaceRoot, permissions)]),
    ...(web === undefined ? [] : [web]),
  ];
  const combined = parts.length === 1 ? workspace : combineToolkits(parts);
  return restrictToolkit(combined, { allow: config.allowedTools, deny: config.disallowedTools });
}

function effectivePermissions(config: AgentConfig): AgentPermissions {
  const base = config.permissions ?? {
    allow:
      config.mcp === undefined
        ? AGENT_DEFAULT_TOOL_CATEGORIES
        : [...AGENT_DEFAULT_TOOL_CATEGORIES, 'mcp'],
  };
  return config.permissionMode === undefined
    ? base
    : permissionsForMode(config.permissionMode, base);
}
