import path from 'node:path';

import { isApproved } from './permission-modes';
import { createPrTool } from './pr-tool';
import {
  PR_TOOL_DESCRIPTION,
  PR_TOOL_INPUT_SCHEMA,
  PR_TOOL_NAME,
  PR_TOOL_OPERATIONS,
} from './pr-tool.constants';
import { guardToolResult } from './tool-result-guard';

import type { AgentToolkit } from './agent-sdk.types';
import type { PrTool } from './pr-tool.types';
import type { AgentPermissions } from './workspace-toolkit.types';

/** The operations the grants allow; with `offerRefused` every one is listed and refused on arrival. */
function grantedOperations(permissions: AgentPermissions): string[] {
  return Object.entries(PR_TOOL_OPERATIONS)
    .filter(
      ([, category]) => permissions.offerRefused === true || permissions.allow.includes(category),
    )
    .map(([operation]) => operation);
}

/**
 * The `workspace.pr` toolkit: view, review and merge a pull request through `gh`.
 *
 * It exists only when the caller switched it on (`pullRequests`). `view` needs the
 * `http` grant; `review` and `merge` need `http-write` AND an approval callback:
 * with none they are denied, because a pull request is shared state on another
 * machine and is never changed unasked.
 */
export function prToolkit(
  workspaceRoot: string,
  permissions: AgentPermissions,
  tool: PrTool = createPrTool(),
): AgentToolkit {
  const workspace = path.resolve(workspaceRoot);
  const operations = grantedOperations(permissions);
  return {
    definitions:
      operations.length === 0
        ? []
        : [
            {
              schemaVersion: '2.0',
              name: PR_TOOL_NAME,
              version: '1.0.0',
              description: PR_TOOL_DESCRIPTION,
              operations,
              riskClasses: ['network'],
              targetIds: ['target:workspace'],
              inputSchema: PR_TOOL_INPUT_SCHEMA,
            },
          ],
    execute: async (call, signal) =>
      guardToolResult(await tool.execute(call.operation, call.arguments, { workspace, signal })),
    authorize: async (call) => {
      const category = PR_TOOL_OPERATIONS[call.operation];
      if (call.toolName !== PR_TOOL_NAME || category === undefined) return false;
      if (!permissions.allow.includes(category)) return false;
      if (permissions.approve === undefined) return category === 'http';
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
