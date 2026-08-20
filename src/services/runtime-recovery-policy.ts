export type RuntimeFailureClass =
  | 'malformed-tool-output'
  | 'empty-response'
  | 'discovery-loop'
  | 'timeout'
  | 'gate-failure'
  | 'ambiguous-mutation'
  | 'unknown';

export type RuntimeRecoveryStrategy =
  'retry-same' | 'retry-constrained' | 'retry-fallback-model' | 'replan' | 'abandon';

export interface RuntimeFailureContext {
  readonly blocker: string;
  /** The executor threw, so whether the task's effects landed is unknown. */
  readonly thrown: boolean;
  /** The task declares a write set, so a replay could duplicate an effect. */
  readonly mutating: boolean;
}

export interface RuntimeRecoveryRecord {
  readonly failureClass: RuntimeFailureClass;
  readonly strategy: RuntimeRecoveryStrategy;
  readonly reason: string;
}

export interface ReplanCandidateTask {
  readonly taskId: string;
  readonly dependencies: readonly string[];
}

export const retryingRecoveryStrategies: readonly RuntimeRecoveryStrategy[] = [
  'retry-same',
  'retry-constrained',
  'retry-fallback-model',
];

// Each ladder is ordered by how many times this same hypothesis already failed.
// Every ladder terminates in 'abandon' so one hypothesis can never be retried
// more than three times.
const recoveryLadders: Readonly<Record<RuntimeFailureClass, readonly RuntimeRecoveryStrategy[]>> = {
  'malformed-tool-output': ['retry-constrained', 'retry-fallback-model', 'replan'],
  'empty-response': ['retry-same', 'retry-fallback-model', 'replan'],
  'discovery-loop': ['retry-constrained', 'replan'],
  timeout: ['retry-constrained', 'replan'],
  'gate-failure': ['replan'],
  'ambiguous-mutation': [],
  unknown: ['retry-same', 'replan'],
};

// Order matters: the first match wins. A deterministic gate or acceptance
// failure must never be captured by a retryable signature that happens to also
// appear in its message, such as "acceptance check failed: the build timed out".
const failureSignatures: readonly (readonly [RegExp, RuntimeFailureClass])[] = [
  [/\bgates?\b|acceptance check/iu, 'gate-failure'],
  [/MODEL_TOOL_REQUEST_UNREPAIRABLE|\bmalformed\b/iu, 'malformed-tool-output'],
  [/EMPTY_RESPONSE|empty response/iu, 'empty-response'],
  [/discovery allowance|discovery loop|read limit/iu, 'discovery-loop'],
  [/budget exhausted|\btimed?[ -]?out\b/iu, 'timeout'],
];

export function classifyRuntimeFailure(
  context: RuntimeFailureContext,
  history: readonly RuntimeRecoveryRecord[],
): RuntimeRecoveryRecord {
  const failureClass = failureClassOf(context);
  const ladder = recoveryLadders[failureClass];
  const priorAttempts = history.filter((record) => record.failureClass === failureClass).length;
  const strategy = ladder[priorAttempts] ?? 'abandon';
  return { failureClass, strategy, reason: reasonFor(failureClass, strategy, priorAttempts) };
}

function failureClassOf(context: RuntimeFailureContext): RuntimeFailureClass {
  // A thrown failure leaves the task's effects unknown. Replaying a mutating
  // task from that state could duplicate a write that already landed, so this
  // outranks every message-based signature.
  if (context.thrown && context.mutating) return 'ambiguous-mutation';
  const signature = failureSignatures.find(([pattern]) => pattern.test(context.blocker));
  return signature?.[1] ?? 'unknown';
}

function reasonFor(
  failureClass: RuntimeFailureClass,
  strategy: RuntimeRecoveryStrategy,
  priorAttempts: number,
): string {
  if (failureClass === 'ambiguous-mutation')
    return 'Ambiguous mutation cannot be replayed without reconciliation';
  return `${failureClass} attempt ${String(priorAttempts + 1)} resolved to ${strategy}`;
}

export function isRetryingStrategy(strategy: RuntimeRecoveryStrategy): boolean {
  return retryingRecoveryStrategies.includes(strategy);
}

/**
 * The failed tasks plus every task that transitively depends on one, so a
 * replan reworks only the affected subtree and keeps independent successes.
 */
export function affectedReplanTaskIds(
  tasks: readonly ReplanCandidateTask[],
  failedTaskIds: readonly string[],
): readonly string[] {
  const known = new Set(tasks.map(({ taskId }) => taskId));
  const affected = new Set(failedTaskIds.filter((taskId) => known.has(taskId)));
  let grew = true;
  while (grew) {
    grew = false;
    for (const task of tasks) {
      if (affected.has(task.taskId)) continue;
      if (!task.dependencies.some((dependency) => affected.has(dependency))) continue;
      affected.add(task.taskId);
      grew = true;
    }
  }
  return [...affected];
}
