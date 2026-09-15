/**
 * What a run uses when the caller says nothing.
 *
 * Every one of these is a decision, so they are named rather than scattered as
 * inline fallbacks where a reader would have to find them. The budget in
 * particular is a promise about cost: a caller who never sets one should still
 * get a run that ends.
 */
export const AGENT_SDK_DEFAULTS = {
  backendUrl: 'https://claw.local/api/v1',
  // Ollama's connector rather than a metered provider. A default that needs a
  // paid balance turns "run the check" into "top up an account first", and the
  // lane that proves the agent codes should not be the one nobody can run.
  provider: 'OLLAMA',
  model: 'kimi-k3',
  title: 'Agent run',
  deadlineMs: 300_000,
  budget: {
    maxModelTurns: 20,
    maxToolCalls: 40,
    maxToolRounds: 20,
    maxRepairAttempts: 1,
    maxRuntimeMs: 300_000,
    maxOutputBytes: 1_048_576,
    maxToolResultBytes: 262_144,
  },
} as const;
