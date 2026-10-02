import { AGENT_SDK_DEFAULTS } from './agent-sdk.constants';
import { browserToolkit } from './browser-toolkit';
import { knowledgeToolkit } from './knowledge-toolkit';
import { mcpToolkit } from './mcp-toolkit';
import { permissionsForMode } from './permission-modes';
import { processWatchToolkit } from './process-watch-toolkit';
import { PLAN_TOOL_WITHHELD_PATTERN } from './task-plan-tool.constants';
import { combineToolkits, restrictToolkit } from './toolkit-compose';
import { httpVision } from './vision-port-http';
import { visionToolkit } from './vision-tool';
import { httpWebResearch } from './web-research-http';
import { webToolkit } from './web-toolkit';
import { workspaceToolkit } from './workspace-toolkit';
import { AGENT_DEFAULT_TOOL_CATEGORIES } from './workspace-toolkit.constants';

import type { AgentToolkit } from './agent-sdk.types';
import type { AgentTeam } from './agent-team-tool.types';
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
 * toolkit is built. With a `team` and the `agents` grant, `agent.team` is offered too.
 */
export function agentToolkit(
  config: AgentConfig,
  memory?: WorkspaceMemory,
  token: () => string | undefined = () => undefined,
  team?: AgentTeam,
): AgentToolkit {
  const permissions = effectivePermissions(config);
  const workspace = workspaceToolkit(config.workspaceRoot, permissions, {
    ...memory,
    secretEnvironment: config.secretEnvironment,
  });
  const parts = [
    workspace,
    ...(offersProcessWatch(permissions)
      ? [processWatchToolkit(config.workspaceRoot, permissions, memory)]
      : []),
    ...optionalParts(config, permissions, token, team),
  ];
  const combined = parts.length === 1 ? workspace : combineToolkits(parts);
  return restrictToolkit(combined, {
    allow: config.allowedTools,
    deny: offersPlan(config)
      ? config.disallowedTools
      : [...(config.disallowedTools ?? []), PLAN_TOOL_WITHHELD_PATTERN],
  });
}

/** The toolkits that exist only when their option, grant or research mode asks for them. */
function optionalParts(
  config: AgentConfig,
  permissions: AgentPermissions,
  token: () => string | undefined,
  team: AgentTeam | undefined,
): readonly AgentToolkit[] {
  const backendUrl = config.backendUrl ?? AGENT_SDK_DEFAULTS.backendUrl;
  const parts: (AgentToolkit | undefined)[] = [
    config.loadKnowledge === true ? knowledgeToolkit(config.workspaceRoot, permissions) : undefined,
    config.mcp === undefined
      ? undefined
      : mcpToolkit(config.mcp, config.workspaceRoot, permissions),
    config.research === undefined
      ? undefined
      : webToolkit(config.research, config.webResearch ?? httpWebResearch(backendUrl, token)),
    permissions.allow.includes('browser')
      ? browserToolkit(config.browser ?? {}, permissions)
      : undefined,
    config.vision === undefined
      ? undefined
      : visionToolkit({
          workspace: config.workspaceRoot,
          permissions,
          model: config.vision.model,
          port: config.vision.port ?? httpVision(backendUrl, token),
        }),
    team?.toolkit(permissions.allow, permissions.approve),
  ];
  return parts.filter((part): part is AgentToolkit => part !== undefined);
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

/** `process.watch` rides on the `command` grant; plan mode lists it so a refusal is answerable. */
function offersProcessWatch(permissions: AgentPermissions): boolean {
  return permissions.allow.includes('command') || permissions.offerRefused === true;
}

/** `task.plan` is offered when the run asked for a plan in any of the three ways. */
function offersPlan(config: AgentConfig): boolean {
  return (
    config.taskPlan === true || config.requirePlan === true || (config.planSteps ?? []).length > 0
  );
}
