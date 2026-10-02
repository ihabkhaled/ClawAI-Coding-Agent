import path from 'node:path';

import { allowedExecutables } from '../headless/headless-command-policy';

import { createCommandTool } from './command-tool';
import { redactingCommandTool, secretCommandRuntime } from './command-tool-secrets';
import { httpCategory } from './http-tool-request';
import { HTTP_TOOL_NAME } from './http-tool.constants';
import { createNotesStore } from './notes-store';
import { createNotesTool } from './notes-tool';
import { isApproved } from './permission-modes';
import { SHELL_TOOL_NAME } from './shell-tool.constants';
import { executeWorkspaceTool } from './workspace-tool-executor';
import { grantedCategories, workspaceExtras } from './workspace-toolkit-extras';
import {
  AGENT_TOOL_OPERATIONS,
  AGENT_WORKSPACE_TOOL_DEFINITIONS,
} from './workspace-toolkit.constants';
import { createWriteScope } from './write-scope';
import { scopeCommandTool } from './write-scope-audit';

import type { AgentToolCall, AgentToolkit } from './agent-sdk.types';
import type { CommandTool } from './command-tool.types';
import type { ShellTool } from './shell-tool.types';
import type {
  AgentPermissions,
  AgentToolCategory,
  WorkspaceMemory,
} from './workspace-toolkit.types';
import type { JobSecretEnvironment } from '../core/job-secrets.types';

/**
 * The built-in toolkit: files, a bounded command, and read-only git, all
 * scoped to `workspaceRoot` and filtered by `permissions`.
 *
 * Filtering happens twice on purpose. The model is only offered the operations
 * it was granted, so it does not spend turns discovering refusals; and every
 * call is checked again on arrival, because what the model was offered is not
 * a guarantee of what it will ask for.
 */
export function workspaceToolkit(
  workspaceRoot: string,
  permissions: AgentPermissions,
  memory: WorkspaceMemory = {},
): AgentToolkit {
  const writeScope = createWriteScope(
    { scope: permissions.writeScope, deny: permissions.writeDeny },
    { onViolation: memory.onWriteScopeViolation },
  );
  // `.git` stays denied for file and git writes even when no scope is configured.
  const granted = grantedCategories(permissions);
  const guard =
    writeScope === undefined &&
    (granted.includes('write') || granted.includes('git-write') || granted.includes('shell'))
      ? createWriteScope({}, { alwaysGuard: true, onViolation: memory.onWriteScopeViolation })
      : undefined;
  const limits = {
    workspace: path.resolve(workspaceRoot),
    allowedExecutables: allowedExecutables(permissions.allowedExecutables ?? []),
    writeScope: writeScope ?? guard,
  };
  const baseCommands = baseCommandTool(memory.secretEnvironment);
  const commands =
    writeScope === undefined ? baseCommands : scopeCommandTool(baseCommands, writeScope);
  const store =
    memory.store ??
    createNotesStore({
      workspace: limits.workspace,
      threadId: () => undefined,
      stateDirectory: undefined,
    });
  const notes = createNotesTool(store, memory.onNoteAdded);
  const { extras, httpDefinitions } = workspaceExtras({ limits, permissions, memory, granted });
  const offered = offeredDefinitions(
    granted,
    permissions.offerRefused === true,
    permissions.shell !== undefined,
  );
  return {
    definitions: [...offered, ...httpDefinitions],
    execute: (call, signal) => executeWorkspaceTool(call, limits, signal, commands, notes, extras),
    dispose: () => {
      commands.dispose();
    },
    authorize: async (call) => {
      const category = toolCategory(call);
      if (category === undefined || !granted.includes(category)) return false;
      if (category === 'shell')
        return authorizeShell(call, extras.shell, limits.workspace, permissions);
      if (permissions.approve === undefined) return true;
      return isApproved(await permissions.approve({ ...call, category }));
    },
  };
}

/**
 * A script is screened first, so the operator is never asked about one that
 * would be refused (the call then runs, and `execute` refuses it with the
 * reason). What passes is ALWAYS put to the approval callback; with none, it is
 * denied, because a shell is never granted by default.
 */
async function authorizeShell(
  call: AgentToolCall,
  shell: ShellTool | undefined,
  workspace: string,
  permissions: AgentPermissions,
): Promise<boolean> {
  if (shell === undefined || call.toolName !== SHELL_TOOL_NAME) return false;
  if (shell.screen(call.arguments, workspace) !== undefined) return true;
  if (permissions.approve === undefined) return false;
  return isApproved(await permissions.approve({ ...call, category: 'shell' }));
}

/** The command tool; with a routine's secrets it spawns with them and scrubs its results. */
function baseCommandTool(secrets: JobSecretEnvironment | undefined): CommandTool {
  if (secrets === undefined || Object.keys(secrets).length === 0) return createCommandTool();
  return redactingCommandTool(createCommandTool(secretCommandRuntime(secrets)), secrets);
}

/** The category a call falls in, or undefined for a tool this SDK does not run. */
export function toolCategory(call: AgentToolCall): AgentToolCategory | undefined {
  if (call.toolName === HTTP_TOOL_NAME) {
    return call.operation === 'request' ? httpCategory(call.arguments) : undefined;
  }
  return AGENT_TOOL_OPERATIONS[call.toolName]?.[call.operation];
}

/**
 * The tool definitions narrowed to the granted operations; empty tools are
 * dropped. With `offerRefused` every operation is listed and the withheld ones
 * are refused when called.
 */
export function offeredDefinitions(
  allow: readonly AgentToolCategory[],
  offerRefused = false,
  shellEnabled = false,
): readonly unknown[] {
  return AGENT_WORKSPACE_TOOL_DEFINITIONS.flatMap((definition) => {
    const categories = AGENT_TOOL_OPERATIONS[definition.name] ?? {};
    const operations = definition.operations.filter((operation) => {
      const category = categories[operation];
      if (category === undefined) return false;
      // A withheld shell is listed only when the operator switched it on; otherwise it does not exist.
      return allow.includes(category) || (offerRefused && (category !== 'shell' || shellEnabled));
    });
    return operations.length === 0 ? [] : [{ ...definition, operations }];
  });
}
