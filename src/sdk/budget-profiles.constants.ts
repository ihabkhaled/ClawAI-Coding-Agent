import { AGENT_SDK_DEFAULTS } from './agent-sdk.constants';

import type { AgentBudgetField, AgentBudgetProfile } from './agent-sdk.types';

/** The profile names, in the order the CLI lists them. */
export const AGENT_BUDGET_PROFILE_NAMES: readonly AgentBudgetProfile[] = ['default', 'long'];

/**
 * The run budget each profile asks the runtime for.
 *
 * `default` is the conservative allowance a library caller gets when they say
 * nothing. `long` is the runtime's own maximum for every field (chat-service
 * `runBudgetSchema`): a real coding task reads dozens of files, and the server
 * counts result bytes and tool calls cumulatively for the whole run, so the
 * default ends such a run after a handful of reads. The server value is a
 * ceiling, not a cost bound: the caller's own guards (tool calls, duration)
 * stay the real limit.
 */
export const AGENT_BUDGET_PROFILES: Readonly<
  Record<AgentBudgetProfile, Readonly<Record<AgentBudgetField, number>>>
> = {
  default: AGENT_SDK_DEFAULTS.budget,
  long: {
    maxModelTurns: 100,
    maxToolCalls: 500,
    maxToolRounds: 100,
    maxRepairAttempts: 1,
    maxRuntimeMs: 7_200_000,
    maxOutputBytes: 1_048_576,
    maxToolResultBytes: 1_048_576,
  },
};
