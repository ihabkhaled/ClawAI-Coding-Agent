import { ORCHESTRATE_POOL_PREFIX } from './orchestrate-plan.constants';

import type { OrchestratePlan } from './orchestrate.types';

/**
 * Picks models for agents that name a pool. The first agent of a pool gets its
 * first model, the next its second, and so on round the pool, so a plan spreads
 * across cheap models deterministically; a retry moves one place further, so an
 * agent that failed on one model is tried on the next. An agent that names a
 * model id (or none) is left alone.
 */
export function modelPicker(
  plan: OrchestratePlan,
): (agent: string, model: string | undefined, attempt: number) => string | undefined {
  const turns = new Map<string, number>();
  const first = new Map<string, number>();
  return (agent, model, attempt) => {
    if (!model?.startsWith(ORCHESTRATE_POOL_PREFIX)) return model;
    const pool = model.slice(ORCHESTRATE_POOL_PREFIX.length);
    const models = plan.modelPools[pool] ?? [];
    if (models.length === 0) return undefined;
    if (!first.has(agent)) {
      first.set(agent, turns.get(pool) ?? 0);
      turns.set(pool, (turns.get(pool) ?? 0) + 1);
    }
    return models[((first.get(agent) ?? 0) + attempt - 1) % models.length];
  };
}
