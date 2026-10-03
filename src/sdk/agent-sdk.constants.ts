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

/** A run's own failure text that means the model was rate limited, not that the work went wrong. */
export const RATE_LIMIT_FAILURE_PATTERN = /\b429\b|rate[\s-]?limit|too many requests/iu;

/**
 * What the fallback model is told when it takes over a run that was cut off.
 *
 * The thread already holds every earlier message and tool result, so this asks
 * it to check the workspace rather than redo work, and to carry on with the
 * same task.
 */
export const FALLBACK_CONTINUATION_PROMPT =
  'Your previous attempt at the task below was cut off because the model was rate limited. ' +
  'Earlier messages and tool results are in this thread. Check the current state of the workspace, ' +
  'do not repeat steps that already succeeded, and carry on until the task is done.\n\nTask:\n';
