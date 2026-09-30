import { RUNNER_READ_ONLY_CATEGORIES } from './runner-prompt-policy.constants';

import type {
  RunnerApprovalPolicy,
  RunnerToolDecision,
  RunnerToolRequest,
  RunnerWorkspaceFolder,
} from './runner-prompt-policy.types';

/**
 * F099: whether one tool call of a prompt job may run without asking.
 *
 * Only a read-only call on a runner registered with AUTO_APPROVE_READ_ONLY
 * runs unattended. A write or a command (R2 and above) always asks, whatever
 * the policy says, so no server-side setting can widen it.
 */
export function runnerToolDecision(
  request: RunnerToolRequest,
  policy: RunnerApprovalPolicy,
): RunnerToolDecision {
  const readOnly = RUNNER_READ_ONLY_CATEGORIES.includes(request.category);
  return readOnly && policy === 'AUTO_APPROVE_READ_ONLY' ? 'auto' : 'ask';
}

/**
 * The open folder a prompt job runs in. With a repository reference it must
 * name an open folder exactly (case-insensitive); nothing is guessed, so a
 * routine written for one repository never runs in another.
 */
export function resolvePromptWorkspace(
  folders: readonly RunnerWorkspaceFolder[],
  repoRef: string | null | undefined,
): RunnerWorkspaceFolder | undefined {
  if (repoRef === null || repoRef === undefined || repoRef.trim().length === 0) {
    return folders[0];
  }
  const wanted = repoRef.trim().toLowerCase();
  return folders.find((folder) => folder.name.toLowerCase() === wanted);
}

/**
 * A routine names its model as `PROVIDER/model` (for example
 * `GEMINI/gemini-2.5-flash`) or as a bare model for the default provider.
 */
export function splitModelReference(reference: string | undefined): {
  readonly provider: string | undefined;
  readonly model: string | undefined;
} {
  const trimmed = reference?.trim() ?? '';
  if (trimmed.length === 0) return { provider: undefined, model: undefined };
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) return { provider: undefined, model: trimmed };
  return { provider: trimmed.slice(0, slash).toUpperCase(), model: trimmed.slice(slash + 1) };
}
