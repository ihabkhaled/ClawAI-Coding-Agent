import { env } from 'node:process';

import { allowedExecutables } from '../headless/headless-command-policy';
import { headlessStateDirectory } from '../headless/headless-session-store';

import { scopeGatesTool } from './code-gates-scope-guard';
import { createGatesTool } from './code-gates-tool';
import { httpToolPart } from './http-tool-toolkit';
import { isApproved } from './permission-modes';
import { createShellTool } from './shell-tool';
import { createPlanStore } from './task-plan-store';
import { createPlanTool } from './task-plan-tool';

import type { ShellTool } from './shell-tool.types';
import type { PlanToolDeps } from './task-plan-tool.types';
import type { WorkspaceToolExtras } from './workspace-tool-extras.types';
import type {
  AgentPermissions,
  AgentToolCategory,
  WorkspaceMemory,
} from './workspace-toolkit.types';
import type { ToolLimits } from '../headless/headless-main.types';

/**
 * What the plan tool may do with a check the model wrote: only with the
 * `command` grant and an allowed executable, and, where approvals are asked
 * for commands, only once the caller approves the command.
 */
function planDeps(
  workspace: string,
  permissions: AgentPermissions,
  memory: WorkspaceMemory,
): PlanToolDeps {
  const { approve } = permissions;
  return {
    workspace,
    onChanged: memory.onPlanChanged,
    modelChecks: {
      allowed: permissions.allow.includes('command'),
      executables: allowedExecutables(permissions.allowedExecutables ?? []),
      ...(approve === undefined
        ? {}
        : {
            approve: async (check, id) =>
              isApproved(
                await approve({
                  toolName: 'workspace.command',
                  operation: 'run',
                  arguments: { executable: check.executable, arguments: check.args, plan: id },
                  category: 'command',
                }),
              ),
          }),
    },
  };
}

/** The categories in force: `shell` counts only when the operator also switched the shell on. */
export function grantedCategories(permissions: AgentPermissions): readonly AgentToolCategory[] {
  return permissions.shell === undefined
    ? permissions.allow.filter((category) => category !== 'shell')
    : permissions.allow;
}

/** The shell tool, built when both switches are on. */
export function shellToolFor(
  permissions: AgentPermissions,
  scope: ToolLimits['writeScope'],
): ShellTool {
  return createShellTool(
    {
      deny: permissions.shell?.deny,
      logDirectory: permissions.shell?.logDirectory ?? headlessStateDirectory(env),
    },
    scope,
  );
}

/**
 * The optional tools (plan, gates, http, shell) for one toolkit, with the
 * definitions the http tool contributes (it is offered only when a host is allowed).
 */
export function workspaceExtras(input: {
  readonly limits: ToolLimits;
  readonly permissions: AgentPermissions;
  readonly memory: WorkspaceMemory;
  readonly granted: readonly AgentToolCategory[];
}): { readonly extras: WorkspaceToolExtras; readonly httpDefinitions: readonly unknown[] } {
  const { limits, permissions, memory, granted } = input;
  const scope = limits.writeScope;
  const plan = createPlanTool(
    memory.plan ??
      createPlanStore({
        workspace: limits.workspace,
        threadId: () => undefined,
        stateDirectory: undefined,
      }),
    planDeps(limits.workspace, permissions, memory),
  );
  const gates = scope === undefined ? createGatesTool() : scopeGatesTool(createGatesTool(), scope);
  const http = httpToolPart(permissions);
  const shell = granted.includes('shell') ? shellToolFor(permissions, scope) : undefined;
  return { extras: { plan, gates, http: http.tool, shell }, httpDefinitions: http.definitions };
}
