import { z } from 'zod';

import { isSafeRelativeWorkspacePath } from './workspace-path-policy';

/**
 * Accepts an empty `{}` wherever an empty array is valid, then hands the
 * schema a real `[]`.
 *
 * Redis 7.4's Lua cjson cannot represent an empty array — `[]` and `{}` both
 * decode to a table with no entries, and `cjson.encode` writes `{}` for
 * either. Every runtime event this extension receives is decoded and
 * re-encoded inside the backend's Lua state machine on its way here, so a
 * `runtime.agents` graph admitted with `integrationSeams: []` for an
 * independent task arrived at this exact schema as `{}` and failed validation
 * outright — "must be an array" — even though the model sent a perfectly
 * valid empty array and the backend recorded it correctly. A populated array
 * survives the round trip untouched; only the empty case is ambiguous, so
 * only the empty case is repaired here.
 */
function tolerateEmptyObjectAsArray<ArraySchema extends z.ZodType>(
  arraySchema: ArraySchema,
): z.ZodType<z.infer<ArraySchema>> {
  return z.preprocess((value) => {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    ) {
      return [];
    }
    return value;
  }, arraySchema);
}

export const subAgentRoleSchema = z.enum([
  'explorer',
  'implementer',
  'tester',
  'reviewer',
  'security-reviewer',
  'documenter',
  'integrator',
]);
export const subAgentTaskSchema = z
  .object({
    taskId: z.string().regex(/^[a-z][a-z0-9-]{1,99}$/u),
    role: subAgentRoleSchema,
    goal: z.string().min(1).max(20_000),
    modelPolicy: z
      .object({
        allowedProviders: tolerateEmptyObjectAsArray(z.array(z.string().min(1).max(100)).max(100)),
        allowedModels: tolerateEmptyObjectAsArray(z.array(z.string().min(1).max(200)).max(500)),
        localPreferred: z.boolean(),
        minimumContextTokens: z.number().int().nonnegative().max(10_000_000),
      })
      .strict(),
    contextNodeIds: tolerateEmptyObjectAsArray(z.array(z.string().min(3).max(500)).max(10_000)),
    dependencies: tolerateEmptyObjectAsArray(
      z.array(z.string().regex(/^[a-z][a-z0-9-]{1,99}$/u)).max(1_000),
    ),
    writeSet: tolerateEmptyObjectAsArray(
      z.array(z.string().refine(isSafeRelativeWorkspacePath)).max(10_000),
    ),
    integrationSeams: tolerateEmptyObjectAsArray(z.array(z.string().min(1).max(1_000)).max(1_000)),
    worktreeId: z.string().min(3).max(200),
    budget: z
      .object({
        maxTokens: z.number().int().positive().max(10_000_000),
        maxToolCalls: z.number().int().nonnegative().max(10_000),
        maxRuntimeMs: z.number().int().min(1_000).max(86_400_000),
        maxRetries: z.number().int().nonnegative().max(5),
      })
      .strict(),
    tools: tolerateEmptyObjectAsArray(z.array(z.string().min(2).max(80)).max(256)),
    riskCeiling: z.enum(['R0', 'R1', 'R2', 'R3']),
    acceptanceChecks: z.array(z.string().min(1).max(2_000)).min(1).max(200),
    epochs: z
      .object({
        account: z.number().int().nonnegative(),
        workspace: z.number().int().nonnegative(),
        target: z.number().int().nonnegative(),
        policy: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type SubAgentTask = z.infer<typeof subAgentTaskSchema>;
export type SubAgentTaskStatus =
  'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'blocked';

export const subAgentGraphSchema = z
  .object({
    graphId: z.string().min(8).max(200),
    parentRunId: z.string().min(8).max(200),
    tasks: z.array(subAgentTaskSchema).min(1).max(1_000),
    maxConcurrency: z.number().int().min(1).max(32),
  })
  .strict()
  .superRefine((graph, context) => {
    const ids = new Set(graph.tasks.map(({ taskId }) => taskId));
    if (ids.size !== graph.tasks.length)
      context.addIssue({ code: 'custom', message: 'Duplicate sub-agent task' });
    for (const task of graph.tasks) {
      if (task.dependencies.some((dependency) => !ids.has(dependency))) {
        context.addIssue({ code: 'custom', message: 'Unknown sub-agent dependency' });
      }
      if (
        task.role !== 'integrator' &&
        task.tools.some((tool) => /(?:push|publish|elevat)/iu.test(tool))
      ) {
        context.addIssue({ code: 'custom', message: 'Sub-agents cannot publish or elevate' });
      }
    }
    const ownership = new Map<string, string>();
    for (const task of graph.tasks) {
      for (const path of task.writeSet) {
        const owner = ownership.get(path);
        if (owner !== undefined && owner !== task.taskId) {
          context.addIssue({ code: 'custom', message: `Sub-agent write collision: ${path}` });
        }
        ownership.set(path, task.taskId);
      }
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const byId = new Map(graph.tasks.map((task) => [task.taskId, task]));
    const cyclic = (taskId: string): boolean => {
      if (visiting.has(taskId)) return true;
      if (visited.has(taskId)) return false;
      visiting.add(taskId);
      if ((byId.get(taskId)?.dependencies ?? []).some(cyclic)) return true;
      visiting.delete(taskId);
      visited.add(taskId);
      return false;
    };
    if ([...ids].some(cyclic))
      context.addIssue({ code: 'custom', message: 'Sub-agent dependency cycle' });
  });

export type SubAgentGraph = z.infer<typeof subAgentGraphSchema>;

export interface SubAgentOutcome {
  readonly taskId: string;
  readonly status: Extract<SubAgentTaskStatus, 'succeeded' | 'failed' | 'cancelled' | 'blocked'>;
  readonly commit?: string;
  readonly changedPaths: readonly string[];
  readonly tokens: number;
  readonly toolCalls: number;
  readonly modelTurns?: number;
  readonly artifacts: readonly string[];
  readonly blocker?: string;
  readonly graph?: SubAgentGraph;
  /** How many attempts the coordinator spent before this terminal outcome. */
  readonly attempts?: number;
}
