import { classifyMcpOperation } from '../core/mcp/mcp-policy-classification';
import { evaluatePolicyV2 } from '../core/policy-v2';
import {
  classifiedOperation,
  UNCLASSIFIED_OPERATION,
} from '../core/runtime/runtime-operation-classification';

import { classifyBrowserOperation, isBrowserObservation } from './browser-tool-policy';
import {
  HEADLESS_POLICY_INVOCATION_HASH,
  HTTP_READ_CLASSIFICATION,
  HTTP_WRITE_CLASSIFICATION,
  HEADLESS_POLICY_OPERATION_NAMES,
  HEADLESS_POLICY_RUN_ID,
  HEADLESS_POLICY_SCOPE,
  HEADLESS_POLICY_TOOL_NAMES,
} from './permission-mode-policy.constants';
import { COMMAND_TOOL_OBSERVATIONS } from './permission-modes.constants';

import type { AgentPermissionMode } from './permission-modes.types';
import type { AgentApprovalRequest } from './workspace-toolkit.types';
import type { OperationClassification } from '../core/runtime/runtime-operation-classification';

/** What the editor's policy says about one call: run it, ask first, or refuse. */
export type AgentPolicyOutcome = 'allow' | 'ask' | 'deny';

/** The modes whose answer comes from the editor's own policy rather than from a category rule. */
export type PolicyDrivenMode = Extract<AgentPermissionMode, 'autonomous-scoped' | 'strict'>;

/** A call of a `command`-category tool that only observes (see `COMMAND_TOOL_OBSERVATIONS`). */
export function isCommandObservation(request: AgentApprovalRequest): boolean {
  return COMMAND_TOOL_OBSERVATIONS[request.toolName]?.includes(request.operation) === true;
}

export function isPolicyDrivenMode(mode: AgentPermissionMode): mode is PolicyDrivenMode {
  return mode === 'autonomous-scoped' || mode === 'strict';
}

function classificationOf(request: AgentApprovalRequest): OperationClassification {
  if (request.category === 'mcp') return classifyMcpOperation(request.operation);
  if (request.category === 'http') return HTTP_READ_CLASSIFICATION;
  if (request.category === 'http-write') return HTTP_WRITE_CLASSIFICATION;
  if (request.category === 'browser') return classifyBrowserOperation(request.operation);
  const tool = HEADLESS_POLICY_TOOL_NAMES[request.toolName] ?? request.toolName;
  const operation = HEADLESS_POLICY_OPERATION_NAMES[request.operation] ?? request.operation;
  return classifiedOperation(tool, operation) ?? UNCLASSIFIED_OPERATION;
}

/**
 * The outcome the editor's policy gives this call in `autonomous-scoped` or
 * `strict`.
 *
 * It is the editor's own `evaluatePolicyV2`, fed the call's real classification,
 * so the two can never drift: `autonomous-scoped` runs edits and commands and
 * still asks for anything that reaches outside the machine or cannot be undone
 * (a commit, a push, a delete, an MCP call); `strict` asks for everything
 * `ask` does and refuses delete-class work outright. Reading is not asked about
 * in any mode, which is how the category modes treat it too.
 */
export function policyOutcome(
  mode: PolicyDrivenMode,
  request: AgentApprovalRequest,
): AgentPolicyOutcome {
  if (['read', 'git', 'http'].includes(request.category)) return 'allow';
  if (isCommandObservation(request)) return 'allow';
  if (request.category === 'browser' && isBrowserObservation(request.operation)) return 'allow';
  // A shell script cannot be classified, so the policy never runs one unasked.
  if (request.category === 'shell') return 'ask';
  return evaluatePolicyV2({
    runId: HEADLESS_POLICY_RUN_ID,
    invocationHash: HEADLESS_POLICY_INVOCATION_HASH,
    mode: mode === 'strict' ? 'ENTERPRISE_LOCKED' : 'AUTONOMOUS_SCOPED',
    ...classificationOf(request),
    scope: HEADLESS_POLICY_SCOPE,
    workspaceTrusted: true,
    userPresent: true,
  }).outcome;
}
