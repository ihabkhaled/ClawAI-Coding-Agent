import path from 'node:path';

import { allowedExecutables } from '../headless/headless-command-policy';

import { createCommandTool } from './command-tool';
import { createNotesStore } from './notes-store';
import { createNotesTool } from './notes-tool';
import { executeWorkspaceTool } from './workspace-tool-executor';
import {
  AGENT_TOOL_OPERATIONS,
  AGENT_WORKSPACE_TOOL_DEFINITIONS,
} from './workspace-toolkit.constants';
import { createWriteScope } from './write-scope';
import { scopeCommandTool } from './write-scope-audit';

import type { AgentToolCall, AgentToolkit } from './agent-sdk.types';
import type {
  AgentPermissions,
  AgentToolCategory,
  WorkspaceMemory,
} from './workspace-toolkit.types';

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
  const limits = {
    workspace: path.resolve(workspaceRoot),
    allowedExecutables: allowedExecutables(permissions.allowedExecutables ?? []),
    writeScope,
  };
  const commands =
    writeScope === undefined
      ? createCommandTool()
      : scopeCommandTool(createCommandTool(), writeScope);
  const store =
    memory.store ??
    createNotesStore({
      workspace: limits.workspace,
      threadId: () => undefined,
      stateDirectory: undefined,
    });
  const notes = createNotesTool(store, memory.onNoteAdded);
  return {
    definitions: offeredDefinitions(permissions.allow, permissions.offerRefused === true),
    execute: (call, signal) => executeWorkspaceTool(call, limits, signal, commands, notes),
    dispose: () => {
      commands.dispose();
    },
    authorize: async (call) => {
      const category = toolCategory(call);
      if (category === undefined || !permissions.allow.includes(category)) return false;
      if (permissions.approve === undefined) return true;
      return permissions.approve({ ...call, category });
    },
  };
}

/** The category a call falls in, or undefined for a tool this SDK does not run. */
export function toolCategory(call: AgentToolCall): AgentToolCategory | undefined {
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
): readonly unknown[] {
  return AGENT_WORKSPACE_TOOL_DEFINITIONS.flatMap((definition) => {
    const categories = AGENT_TOOL_OPERATIONS[definition.name] ?? {};
    const operations = definition.operations.filter((operation) => {
      const category = categories[operation];
      return category !== undefined && (offerRefused || allow.includes(category));
    });
    return operations.length === 0 ? [] : [{ ...definition, operations }];
  });
}
