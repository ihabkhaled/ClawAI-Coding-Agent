import path from 'node:path';

import { allowedExecutables } from '../headless/headless-command-policy';

import { isApproved } from './permission-modes';
import { scopeProcessWatch } from './process-watch-scope';
import { createProcessWatchTool } from './process-watch-tool';
import {
  PROCESS_WATCH_DESCRIPTION,
  PROCESS_WATCH_INPUT_SCHEMA,
  PROCESS_WATCH_OPERATIONS,
  PROCESS_WATCH_TOOL_NAME,
} from './process-watch-tool.constants';
import { guardToolResult } from './tool-result-guard';
import { createWriteScope } from './write-scope';

import type { AgentToolkit } from './agent-sdk.types';
import type { AgentPermissions, WorkspaceMemory } from './workspace-toolkit.types';

/** The definition the model is shown. */
export const PROCESS_WATCH_DEFINITION = {
  schemaVersion: '2.0',
  name: PROCESS_WATCH_TOOL_NAME,
  version: '1.0.0',
  description: PROCESS_WATCH_DESCRIPTION,
  operations: Object.keys(PROCESS_WATCH_OPERATIONS),
  riskClasses: ['process'],
  targetIds: ['target:workspace'],
  inputSchema: PROCESS_WATCH_INPUT_SCHEMA,
} as const;

/**
 * The `process.watch` toolkit: long-lived programs a run can start and watch.
 *
 * It is offered with the `command` grant, the same one `workspace.command`
 * needs, and is authorized the same way (so `ask` and `strict` put it to the
 * approval callback). Results pass through the shared size guard.
 */
export function processWatchToolkit(
  workspaceRoot: string,
  permissions: AgentPermissions,
  memory: WorkspaceMemory = {},
): AgentToolkit {
  const writeScope = createWriteScope(
    { scope: permissions.writeScope, deny: permissions.writeDeny },
    { onViolation: memory.onWriteScopeViolation },
  );
  const base = createProcessWatchTool();
  const tool = writeScope === undefined ? base : scopeProcessWatch(base, writeScope);
  const limits = {
    workspace: path.resolve(workspaceRoot),
    allowedExecutables: allowedExecutables(permissions.allowedExecutables ?? []),
    writeScope,
  };
  const offered = permissions.allow.includes('command') || permissions.offerRefused === true;
  return {
    definitions: offered ? [PROCESS_WATCH_DEFINITION] : [],
    execute: async (call, signal) =>
      guardToolResult(await tool.execute(call.operation, call.arguments, limits, signal)),
    dispose: () => {
      tool.dispose();
    },
    authorize: async (call) => {
      const category = PROCESS_WATCH_OPERATIONS[call.operation];
      if (category === undefined || !permissions.allow.includes(category)) return false;
      if (permissions.approve === undefined) return true;
      return isApproved(
        await permissions.approve({
          ...call,
          arguments: structuredClone(call.arguments),
          category,
        }),
      );
    },
  };
}
