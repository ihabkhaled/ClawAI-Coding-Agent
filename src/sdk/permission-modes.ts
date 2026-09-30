import { AGENT_PLAN_TOOL_CATEGORIES } from './permission-modes.constants';

import type { AgentPermissionMode } from './permission-modes.types';
import type { AgentApprovalRequest, AgentPermissions } from './workspace-toolkit.types';

/** Whether this call must be put to the approval callback under `mode`. */
export function needsApproval(mode: AgentPermissionMode, request: AgentApprovalRequest): boolean {
  if (request.category === 'read' || request.category === 'git') return false;
  if (request.category === 'mcp') return request.operation === 'call';
  if (request.category === 'command') return true;
  return mode === 'ask';
}

/**
 * The permissions a mode implies, given the caller's grants and callback.
 *
 * `plan` narrows the grants; the other two keep them and decide, per call,
 * whether the callback is asked. The callback is the caller's own, so a CLI
 * can prompt on a terminal and a service can consult a queue.
 */
export function permissionsForMode(
  mode: AgentPermissionMode,
  base: AgentPermissions,
): AgentPermissions {
  if (mode === 'plan') {
    return {
      ...base,
      allow: base.allow.filter((category) => AGENT_PLAN_TOOL_CATEGORIES.includes(category)),
      approve: undefined,
    };
  }
  const ask = base.approve;
  return {
    ...base,
    approve: async (request) => {
      if (!needsApproval(mode, request)) return true;
      return ask === undefined ? false : ask(request);
    },
  };
}
