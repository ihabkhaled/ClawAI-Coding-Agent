import { isPolicyDrivenMode, policyOutcome } from './permission-mode-policy';
import { AGENT_PLAN_TOOL_CATEGORIES } from './permission-modes.constants';
import { toolPermissionRow } from './tool-permission-table';

import type { AgentPermissionMode } from './permission-modes.types';
import type { ToolDecision } from './tool-permission-table.types';
import type { AgentApprovalRequest, AgentPermissions } from './workspace-toolkit.types';

/**
 * What `mode` does with this call: run it, put it to the approval callback, or
 * refuse it. A tool in `TOOL_PERMISSION_ROWS` is decided by its row alone; an
 * older tool by the category rules below, and for `autonomous-scoped` and
 * `strict` by the editor's policy. A new category, or a new operation of a
 * tool the table does not know, is asked about rather than run.
 */
export function decisionFor(
  mode: AgentPermissionMode,
  request: AgentApprovalRequest,
): ToolDecision {
  const row = toolPermissionRow(request);
  if (row !== undefined) return row.decisions[mode];
  if (isPolicyDrivenMode(mode)) return policyOutcome(mode, request);
  if (['read', 'git', 'http'].includes(request.category)) return 'allow';
  if (request.category === 'mcp') return request.operation === 'call' ? 'ask' : 'allow';
  if (
    ['command', 'git-write', 'http-write', 'shell', 'browser', 'agents'].includes(request.category)
  ) {
    return 'ask';
  }
  return mode === 'ask' ? 'ask' : 'allow';
}

/**
 * Whether this call must be put to the approval callback under `mode`.
 *
 * A call the mode refuses outright is handled by `permissionsForMode` and never
 * reaches the callback.
 */
export function needsApproval(mode: AgentPermissionMode, request: AgentApprovalRequest): boolean {
  return decisionFor(mode, request) === 'ask';
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
      const decision = decisionFor(mode, request);
      if (decision === 'deny') return false;
      if (decision === 'allow') return true;
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
