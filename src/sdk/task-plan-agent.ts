import path from 'node:path';
import { env } from 'node:process';

import { headlessStateDirectory } from '../headless/headless-session-store';

import { parseSteps } from './task-plan-steps';
import { createPlanStore } from './task-plan-store';

import type { AgentConfig } from './create-agent.types';
import type { PlanStore } from './task-plan-tool.types';

/**
 * The plan of one agent: a store keyed by the conversation, blank for a new
 * thread (like the notes, so an earlier task's plan cannot steer a fresh one),
 * and loaded with the orchestrator's steps, locked, when `planSteps` is given.
 * A resumed conversation that already has a plan keeps it. Bad steps throw
 * before any run starts.
 */
export function openPlan(
  config: AgentConfig,
  threadId: () => string | undefined,
): { readonly plan: PlanStore; readonly preloaded: boolean } {
  const plan = createPlanStore({
    workspace: path.resolve(config.workspaceRoot),
    threadId,
    stateDirectory: headlessStateDirectory(env),
  });
  if (config.threadId === undefined) plan.clear();
  const wanted = config.planSteps ?? [];
  if (wanted.length === 0) return { plan, preloaded: false };
  const steps = parseSteps(wanted, true);
  if (plan.list().length > 0) return { plan, preloaded: false };
  plan.save(steps);
  return { plan, preloaded: true };
}
