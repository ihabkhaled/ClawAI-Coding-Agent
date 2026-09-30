import { z } from 'zod';

/** A scheduled command on a paired device: the backend's unit of remote work. */
export const remoteJobSchema = z
  .object({
    id: z.string().min(1),
    /** Null for a PROMPT routine (F099), which runs on a runner. */
    deviceId: z.string().min(1).nullable(),
    name: z.string(),
    command: z.string(),
    workingDir: z.string().nullable().optional(),
    intervalMinutes: z.number().int(),
    status: z.string(),
    lastRunAt: z.string().nullable().optional(),
    lastCommandId: z.string().nullable().optional(),
    nextRunAt: z.string(),
  })
  .loose();

/** One terminal command a job produced, as far as the agent needs to report it. */
export const remoteCommandSchema = z
  .object({
    id: z.string().min(1),
    status: z.string(),
    command: z.string(),
    exitCode: z.number().int().nullable().optional(),
    stdout: z.string().nullable().optional(),
    stderr: z.string().nullable().optional(),
    rejectionReason: z.string().nullable().optional(),
    requestedAt: z.string().optional(),
    completedAt: z.string().nullable().optional(),
  })
  .loose();

export const remoteTriggerSchema = z
  .object({ command: remoteCommandSchema, replayed: z.boolean() })
  .loose();

export const remoteDevicePageSchema = z
  .object({
    data: z.array(
      z.object({ id: z.string().min(1), name: z.string(), status: z.string() }).loose(),
    ),
  })
  .loose();

export const remoteJobListSchema = z.array(remoteJobSchema);
