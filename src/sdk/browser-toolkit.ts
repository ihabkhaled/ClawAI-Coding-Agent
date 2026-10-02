import { createBrowserTool } from './browser-tool';
import {
  BROWSER_TOOL_DESCRIPTION,
  BROWSER_TOOL_INPUT_SCHEMA,
  BROWSER_TOOL_NAME,
  BROWSER_TOOL_OPERATIONS,
} from './browser-tool.constants';
import { isApproved } from './permission-modes';
import { guardToolResult } from './tool-result-guard';

import type { AgentToolkit } from './agent-sdk.types';
import type { PlaywrightLoader } from './browser-session.types';
import type { AgentBrowserOptions } from './browser-tool.types';
import type { AgentPermissions } from './workspace-toolkit.types';

/** `browser.page` as the model is shown it. */
export const browserToolDefinition = {
  schemaVersion: '2.0',
  name: BROWSER_TOOL_NAME,
  version: '1.0.0',
  description: BROWSER_TOOL_DESCRIPTION,
  operations: Object.keys(BROWSER_TOOL_OPERATIONS),
  riskClasses: ['browser', 'network'],
  targetIds: ['target:workspace'],
  inputSchema: BROWSER_TOOL_INPUT_SCHEMA,
} as const;

/**
 * The browser tool for a host-free run.
 *
 * It is offered only when `permissions.allow` grants `browser`, and every call
 * is checked again on arrival and put to `permissions.approve` when there is
 * one. The browser itself starts on the first `open` and closes when the run
 * ends or is cancelled.
 */
export function browserToolkit(
  options: AgentBrowserOptions,
  permissions: AgentPermissions,
  loader?: PlaywrightLoader,
): AgentToolkit {
  const granted = permissions.allow.includes('browser');
  const tool = createBrowserTool(options, loader);
  return {
    definitions: granted ? [browserToolDefinition] : [],
    authorize: async (call) => {
      if (!granted || call.toolName !== BROWSER_TOOL_NAME) return false;
      if (BROWSER_TOOL_OPERATIONS[call.operation] === undefined) return false;
      if (permissions.approve === undefined) return true;
      return isApproved(await permissions.approve({ ...call, category: 'browser' }));
    },
    execute: async (call, signal) =>
      guardToolResult(await tool.execute(call.operation, call.arguments, signal)),
    dispose: () => {
      tool.dispose();
    },
  };
}
