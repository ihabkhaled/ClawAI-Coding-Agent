import { z } from 'zod';

import {
  ORCHESTRATE_AGENT_CATEGORIES,
  ORCHESTRATE_FAILURE_PATTERN,
  ORCHESTRATE_GOAL_MAX_CHARS,
  ORCHESTRATE_MAX_AGENTS,
  ORCHESTRATE_MAX_CHECKS,
  ORCHESTRATE_MAX_GLOBS,
  ORCHESTRATE_MAX_HOSTS,
  ORCHESTRATE_MAX_PARALLEL,
  ORCHESTRATE_MAX_POOL_MODELS,
  ORCHESTRATE_MAX_POOLS,
  ORCHESTRATE_MAX_STAGES,
  ORCHESTRATE_MAX_TIMEOUT_SEC,
  ORCHESTRATE_MODEL_PATTERN,
  ORCHESTRATE_NAME_PATTERN,
  ORCHESTRATE_POOL_NAME_PATTERN,
  ORCHESTRATE_STAGE_PATTERN,
  ORCHESTRATE_TASK_MAX_CHARS,
} from './orchestrate-plan.constants';

const hostList = z
  .array(z.string().min(1).max(120))
  .max(ORCHESTRATE_MAX_HOSTS)
  .describe('Host rules: host, host:port or *.example.com.');

/** A command the orchestrator (never a model) runs without a shell: `npm test`, `node --test`. Exit 0 passes. */
export const orchestrateCheckSchema = z.strictObject({
  label: z.string().min(1).max(80).describe('Names the check in events and the report.'),
  command: z
    .string()
    .min(1)
    .max(1_000)
    .describe('Executable and arguments, split on spaces; "..." groups words. No shell, no pipes.'),
  cwd: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Folder inside the workspace; default the root.'),
  timeoutSec: z.number().int().min(1).max(3_600).optional().describe('Default 600.'),
});

export const orchestrateAgentSchema = z.strictObject({
  name: z
    .string()
    .regex(ORCHESTRATE_NAME_PATTERN)
    .describe('Unique in the plan: a-z, 0-9 and -, up to 24 characters.'),
  task: z
    .string()
    .min(1)
    .max(ORCHESTRATE_TASK_MAX_CHARS)
    .describe(
      'A self-contained brief: goal, exact paths, interfaces, how to verify, what to report.',
    ),
  model: z
    .string()
    .regex(ORCHESTRATE_MODEL_PATTERN)
    .optional()
    .describe('A model id, or "pool:<name>" to take one from modelPools. Default: the run model.'),
  tools: z
    .array(z.enum(ORCHESTRATE_AGENT_CATEGORIES))
    .min(1)
    .max(ORCHESTRATE_AGENT_CATEGORIES.length)
    .describe('Categories the agent holds, at most the run grants. Shell is the shell flag.'),
  writeScope: z
    .array(z.string().min(1).max(200))
    .max(ORCHESTRATE_MAX_GLOBS)
    .default([])
    .describe('Workspace-relative globs the agent may change. Parallel agents must not overlap.'),
  budget: z.strictObject({
    maxToolCalls: z.number().int().min(1).max(2_000),
    maxDurationSec: z.number().int().min(10).max(7_200),
  }),
  doneChecks: z.array(orchestrateCheckSchema).max(ORCHESTRATE_MAX_CHECKS).default([]),
  isolation: z
    .enum(['worktree', 'none'])
    .default('none')
    .describe('worktree: own git checkout from HEAD, merged back when the agent completes.'),
  http: z.strictObject({ allowHosts: hostList }).optional(),
  browser: z.strictObject({ allowHosts: hostList }).optional(),
  shell: z
    .boolean()
    .default(false)
    .describe(
      'Gives the agent workspace.shell. The run must have the shell on; every script is approved.',
    ),
});

export const orchestrateStageSchema = z.strictObject({
  id: z.string().regex(ORCHESTRATE_STAGE_PATTERN),
  dependsOn: z
    .array(z.string().regex(ORCHESTRATE_STAGE_PATTERN))
    .max(ORCHESTRATE_MAX_STAGES)
    .default([]),
  agents: z.array(orchestrateAgentSchema).min(1).max(ORCHESTRATE_MAX_AGENTS),
  gate: z
    .strictObject({
      doneChecks: z.array(orchestrateCheckSchema).min(1).max(ORCHESTRATE_MAX_CHECKS),
    })
    .optional()
    .describe('Checks the orchestrator runs after every agent of the stage has finished.'),
});

export const orchestratePlanSchema = z.strictObject({
  name: z.string().regex(ORCHESTRATE_NAME_PATTERN),
  goal: z.string().min(1).max(ORCHESTRATE_GOAL_MAX_CHARS),
  workspace: z.string().min(1).max(500).default('.').describe('The folder every agent works in.'),
  stages: z.array(orchestrateStageSchema).min(1).max(ORCHESTRATE_MAX_STAGES),
  maxParallel: z
    .number()
    .int()
    .min(1)
    .max(ORCHESTRATE_MAX_PARALLEL)
    .default(2)
    .describe('Agents running at once, across all stages.'),
  onFailure: z
    .string()
    .regex(ORCHESTRATE_FAILURE_PATTERN)
    .default('stop')
    .describe('stop | continue | retry:1..3. See docs/ORCHESTRATION.md.'),
  timeoutSec: z.number().int().min(10).max(ORCHESTRATE_MAX_TIMEOUT_SEC).optional(),
  modelPools: z
    .record(
      z.string().regex(ORCHESTRATE_POOL_NAME_PATTERN),
      z.array(z.string().regex(ORCHESTRATE_MODEL_PATTERN)).min(1).max(ORCHESTRATE_MAX_POOL_MODELS),
    )
    .refine((pools) => Object.keys(pools).length <= ORCHESTRATE_MAX_POOLS, 'Too many pools.')
    .default({}),
});
