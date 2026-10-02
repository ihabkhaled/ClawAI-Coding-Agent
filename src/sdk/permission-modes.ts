import { BROWSER_ACTING_OPERATIONS } from './browser-tool.constants';
import { isCommandObservation, isPolicyDrivenMode, policyOutcome } from './permission-mode-policy';
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
  // Starting a child is asked about in `ask` and `strict`; the child's own calls are asked on their merits.
  if (request.category === 'agents') return agentsNeedApproval(mode, request);
  if (isPolicyDrivenMode(mode)) return policyOutcome(mode, request) === 'ask';
  if (['read', 'git', 'http'].includes(request.category)) return false;
  if (request.category === 'mcp') return request.operation === 'call';
  if (isCommandObservation(request)) return false;
  if (request.category === 'browser') return BROWSER_ACTING_OPERATIONS.includes(request.operation);
  if (['command', 'git-write', 'http-write', 'shell'].includes(request.category)) return true;
  return mode === 'ask';
}

function agentsNeedApproval(mode: AgentPermissionMode, request: AgentApprovalRequest): boolean {
  return request.operation === 'spawn' && (mode === 'ask' || mode === 'strict');
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
      if (request.category !== 'agents' && isPolicyDrivenMode(mode)) {
        if (policyOutcome(mode, request) === 'deny') return false;
      }
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
