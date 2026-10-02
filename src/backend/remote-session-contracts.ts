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
    command: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
  })
  .loose();

/**
 * One runner as `GET agent/runners` reports it (F100): only connected runners.
 * `compliance` is the last runner-policy verdict, null when none was evaluated;
 * `reason` is a comma-separated list of codes. Self-reported, so it flags a
 * stale runner and proves nothing about identity.
 */
export const runnerPolicyViewSchema = z
  .object({
    id: z.string().min(1),
    compliance: z
      .object({ status: z.string(), reason: z.string().nullable().optional() })
      .loose()
      .nullable()
      .optional(),
  })
  .loose();

/** The route answers a bare array; a wrapped page is accepted too. */
export const runnerPolicyListSchema = z.union([
  z.array(runnerPolicyViewSchema),
  agentPageSchema(runnerPolicyViewSchema).transform((page) => page.data),
]);

export type RunnerPolicyView = z.infer<typeof runnerPolicyViewSchema>;

/**
 * `GET agent/runners/:id/resume` (F095): the runner's own row, whether it is
 * connected with a fresh heartbeat, and the backend protocol. No credential.
 * An older backend answers 404.
 */
export const runnerResumeSchema = z
  .object({
    runner: runnerPolicyViewSchema.extend({ name: z.string().optional() }).loose(),
    online: z.boolean(),
  })
  .loose();

export type RunnerResume = z.infer<typeof runnerResumeSchema>;

export const cloudTaskPageSchema = agentPageSchema(cloudTaskSchema);
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
