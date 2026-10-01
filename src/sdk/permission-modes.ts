import { isPolicyDrivenMode, policyOutcome } from './permission-mode-policy';
import { AGENT_PLAN_TOOL_CATEGORIES } from './permission-modes.constants';

import type { AgentPermissionMode } from './permission-modes.types';
import type { AgentApprovalRequest, AgentPermissions } from './workspace-toolkit.types';

/**
 * Whether this call must be put to the approval callback under `mode`.
 *
 * For `autonomous-scoped` and `strict` this is the editor's policy answering
 * "ask"; a call that policy refuses outright is handled by `permissionsForMode`
 * and never reaches the callback.
 */
export function needsApproval(mode: AgentPermissionMode, request: AgentApprovalRequest): boolean {
  if (isPolicyDrivenMode(mode)) return policyOutcome(mode, request) === 'ask';
  if (request.category === 'read' || request.category === 'git') return false;
  if (request.category === 'mcp') return request.operation === 'call';
  if (request.category === 'command' || request.category === 'git-write') return true;
  return mode === 'ask';
}

/**
 * The permissions a mode implies, given the caller's grants and callback.
 *
 * `plan` narrows the grants; the other modes keep them and decide, per call,
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
      offerRefused: true,
    };
  }
  const ask = base.approve;
  return {
    ...base,
    approve: async (request) => {
      if (isPolicyDrivenMode(mode) && policyOutcome(mode, request) === 'deny') return false;
      if (!needsApproval(mode, request)) return true;
      return ask === undefined ? false : isApproved(await ask(request));
    },
  };
}

/**
 * Whether an approval callback's answer is a grant. Only exactly `true`
 * approves: the callback is caller code, and a truthy string, number or object
 * from a loosely typed one must read as a refusal.
 */
export function isApproved(answer: unknown): boolean {
  return answer === true;
}
