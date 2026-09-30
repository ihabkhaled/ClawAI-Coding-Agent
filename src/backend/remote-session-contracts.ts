import { z } from 'zod';

/** `agent-service` pages carry `total/page/pageSize`, not chat-service's `meta`. */
function agentPageSchema<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item) }).loose();
}

/** One registered runner: a machine running the ClawAI agent daemon. */
export const runnerSessionSchema = z
  .object({
    id: z.string().min(1),
    hostname: z.string(),
    platform: z.string(),
    status: z.string(),
    lastHeartbeatAt: z.string().nullable().optional(),
  })
  .loose();

/** A repository checkout a runner has reported. */
export const runnerRepoSchema = z
  .object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    name: z.string(),
    repoPath: z.string(),
    branch: z.string().nullable().optional(),
    isDirty: z.boolean().optional(),
  })
  .loose();

/** A command dispatched to a runner, as `agent/commands` reports it. */
export const cloudTaskSchema = z
  .object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    status: z.string(),
    stdout: z.string().nullable().optional(),
    stderr: z.string().nullable().optional(),
    exitCode: z.number().int().nullable().optional(),
    rejectionReason: z.string().nullable().optional(),
  })
  .loose();

export const runnerSessionPageSchema = agentPageSchema(runnerSessionSchema);
export const runnerRepoPageSchema = agentPageSchema(runnerRepoSchema);

export type RunnerSession = z.infer<typeof runnerSessionSchema>;
export type RunnerRepo = z.infer<typeof runnerRepoSchema>;
export type CloudTask = z.infer<typeof cloudTaskSchema>;

/**
 * `GET /chat-threads/:id/active-run` (F095): whether a Runtime V2 run is still
 * going on a thread. Carries no content, only enough to decide.
 */
export const threadActiveRunSchema = z
  .object({
    active: z.boolean(),
    runId: z.string().min(1).optional(),
    startedAt: z.string().optional(),
  })
  .loose();

export type ThreadActiveRun = z.infer<typeof threadActiveRunSchema>;
