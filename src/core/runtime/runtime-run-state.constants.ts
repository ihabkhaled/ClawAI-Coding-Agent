/** The twelve states a run can be in. Not wired into admission yet (Wolverine B2 step 4). */
export const RUNTIME_RUN_STATES = [
  'CREATED',
  'PLANNING',
  'RUNNING',
  'WAITING_TOOL',
  'WAITING_APPROVAL',
  'RECOVERING',
  'VERIFYING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'BUDGET_EXHAUSTED',
] as const;

/** States that accept nothing: the run has ended. */
export const RUNTIME_TERMINAL_RUN_STATES = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'BUDGET_EXHAUSTED',
] as const;

/**
 * What can happen to a run. Reasoning, status, text, narration and heartbeat
 * are observations: they are legal in any live state and never move it.
 */
export const RUNTIME_RUN_TRANSITION_EVENTS = [
  'plan.started',
  'run.started',
  'tool.requested',
  'tool.completed',
  'approval.requested',
  'approval.resolved',
  'recovery.started',
  'recovery.succeeded',
  'recovery.exhausted',
  'verify.started',
  'verify.passed',
  'verify.failed',
  'run.paused',
  'run.resumed',
  'run.completed',
  'run.failed',
  'run.blocked',
  'run.cancelled',
  'budget.exhausted',
  'observation.reasoning',
  'observation.status',
  'observation.text',
  'observation.heartbeat',
] as const;

/** Events that only report; they never change the state. */
export const RUNTIME_OBSERVATION_EVENTS = [
  'observation.reasoning',
  'observation.status',
  'observation.text',
  'observation.heartbeat',
] as const;

/** Events that end a run from any live state. */
export const RUNTIME_RUN_ENDING_EVENTS = {
  'run.failed': 'FAILED',
  'run.blocked': 'FAILED',
  'run.cancelled': 'CANCELLED',
  'budget.exhausted': 'BUDGET_EXHAUSTED',
} as const;

/** The legal moves out of each live state, for events that are neither observations nor endings. */
export const RUNTIME_RUN_TRANSITIONS: Readonly<
  Record<string, Readonly<Record<string, (typeof RUNTIME_RUN_STATES)[number]>>>
> = {
  CREATED: { 'plan.started': 'PLANNING', 'run.started': 'RUNNING' },
  PLANNING: { 'run.started': 'RUNNING', 'run.paused': 'PAUSED' },
  RUNNING: {
    'tool.requested': 'WAITING_TOOL',
    'recovery.started': 'RECOVERING',
    'verify.started': 'VERIFYING',
    'run.paused': 'PAUSED',
    'run.completed': 'COMPLETED',
  },
  WAITING_TOOL: {
    'tool.completed': 'RUNNING',
    'approval.requested': 'WAITING_APPROVAL',
    'recovery.started': 'RECOVERING',
    'run.paused': 'PAUSED',
  },
  WAITING_APPROVAL: { 'approval.resolved': 'WAITING_TOOL' },
  RECOVERING: { 'recovery.succeeded': 'RUNNING', 'recovery.exhausted': 'FAILED' },
  VERIFYING: {
    'verify.passed': 'COMPLETED',
    'verify.failed': 'RUNNING',
    'recovery.started': 'RECOVERING',
  },
  PAUSED: { 'run.resumed': 'RUNNING' },
};

/**
 * The five reducer statuses onto the twelve states.
 * `blocked` has no state of its own: a denied tool ends the run as FAILED and
 * the caller keeps the reason. A `failed` run whose code is
 * RUNTIME_BUDGET_EXHAUSTED is BUDGET_EXHAUSTED.
 */
export const RUNTIME_STATUS_TO_RUN_STATE = {
  running: 'RUNNING',
  completed: 'COMPLETED',
  blocked: 'FAILED',
  failed: 'FAILED',
  cancelled: 'CANCELLED',
} as const;

export const RUNTIME_BUDGET_EXHAUSTED_CODE = 'RUNTIME_BUDGET_EXHAUSTED';
