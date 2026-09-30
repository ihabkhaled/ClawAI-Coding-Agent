import { mcpToolkit } from './mcp-toolkit';
import { permissionsForMode } from './permission-modes';
import { combineToolkits, restrictToolkit } from './toolkit-compose';
import { workspaceToolkit } from './workspace-toolkit';
import { AGENT_DEFAULT_TOOL_CATEGORIES } from './workspace-toolkit.constants';

import type { AgentToolkit } from './agent-sdk.types';
import type { AgentConfig } from './create-agent.types';
import type { AgentPermissions } from './workspace-toolkit.types';

/**
 * What a configured agent may do: the workspace tools, the MCP servers when
 * given, the permission mode over both, and the allow and deny lists on top.
 *
 * Without `permissions`, the grant is read and git, plus `mcp` when servers
 * were configured — naming servers is the request to use them.
 */
export function agentToolkit(config: AgentConfig): AgentToolkit {
  const permissions = effectivePermissions(config);
  const workspace = workspaceToolkit(config.workspaceRoot, permissions);
  const combined =
    config.mcp === undefined
      ? workspace
      : combineToolkits([workspace, mcpToolkit(config.mcp, config.workspaceRoot, permissions)]);
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
