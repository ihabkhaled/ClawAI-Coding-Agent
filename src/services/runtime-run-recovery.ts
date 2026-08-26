import { createRuntimeSnapshot } from '../core/runtime/runtime-event-reducer';
import { createSteeringQueue } from '../core/runtime/runtime-steering-queue';

import { ExplicitScopeExecutor, parseExplicitRunScope } from './runtime-explicit-scope';
import { RuntimeToolDispatcher } from './runtime-tool-dispatcher';

import type { RuntimeRunServiceDependencies, RuntimeRunStart } from './runtime-run-service';
import type { RuntimeBudgetState } from '../core/runtime/runtime-run-budget';

export interface RuntimeRunRecovery {
  readonly budget: RuntimeBudgetState;
  readonly lastEventSequence: number;
}

export function createRecoveredRuntimeRun(
  input: RuntimeRunStart,
  recovery: RuntimeRunRecovery,
  dependencies: RuntimeRunServiceDependencies,
) {
  const explicitScope = parseExplicitRunScope(input.prompt);
  const executor =
    explicitScope === undefined
      ? dependencies.executor
      : new ExplicitScopeExecutor(dependencies.executor, explicitScope);
  return {
    controller: new AbortController(),
    currentTurnId: input.turnId,
    dispatcher: new RuntimeToolDispatcher({
      budget: input.budget,
      consumeModelLifecycleBudget: false,
      currentEpochs: dependencies.currentEpochs,
      definitions: input.definitions,
      epochs: input.epochs,
      executor,
      now: () => dependencies.clock.now(),
      policy: dependencies.policy,
      receiptId: dependencies.receiptId,
      restoredBudgetState: recovery.budget,
      runId: input.runId,
      startedAtMs: recovery.budget.startedAtMs,
      turnId: input.turnId,
    }),
    nextSequence: recovery.lastEventSequence + 1,
    snapshot: createRuntimeSnapshot(),
    start: input,
    steering: createSteeringQueue(input.runId, input.epochs),
  };
}

export function recoverRuntimeRun(
  input: RuntimeRunStart,
  recovery: RuntimeRunRecovery,
  dependencies: RuntimeRunServiceDependencies,
) {
  const current = dependencies.currentEpochs();
  if (
    input.epochs.account !== current.account ||
    input.epochs.workspace !== current.workspace ||
    input.epochs.target !== current.target ||
    input.epochs.policy !== current.policy
  ) {
    throw new Error('Runtime run epochs are stale');
  }
  if (JSON.stringify(input.budget) !== JSON.stringify(recovery.budget.budget)) {
    throw new Error('Recovered runtime budget does not match its start contract');
  }
  if (!Number.isInteger(recovery.lastEventSequence) || recovery.lastEventSequence < -1) {
    throw new Error('Recovered runtime event sequence is invalid');
  }
  return createRecoveredRuntimeRun(input, recovery, dependencies);
}
