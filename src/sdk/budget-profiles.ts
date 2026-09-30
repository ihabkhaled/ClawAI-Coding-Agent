import { AGENT_BUDGET_PROFILES } from './budget-profiles.constants';

import type { AgentBudgetField, AgentBudgetProfile } from './agent-sdk.types';

type BudgetOverride = Readonly<Partial<Record<AgentBudgetField, number>>> | undefined;

/**
 * The budget sent with a run: the profile's values, the caller's deadline as the
 * runtime limit, then any field the caller set explicitly, which always wins.
 */
export function resolveRunBudget(
  profile: AgentBudgetProfile | undefined,
  deadlineMs: number,
  override: BudgetOverride,
): Readonly<Record<AgentBudgetField, number>> {
  return { ...AGENT_BUDGET_PROFILES[profile ?? 'default'], maxRuntimeMs: deadlineMs, ...override };
}

/** How long a run is waited for when the caller gave no deadline: the profile's runtime limit. */
export function profileDeadlineMs(profile: AgentBudgetProfile | undefined): number {
  return AGENT_BUDGET_PROFILES[profile ?? 'default'].maxRuntimeMs;
}

/** The result-byte allowance a run under this profile has, for the client-side usage notes. */
export function resultByteLimit(profile: AgentBudgetProfile | undefined): number {
  return AGENT_BUDGET_PROFILES[profile ?? 'default'].maxToolResultBytes;
}
