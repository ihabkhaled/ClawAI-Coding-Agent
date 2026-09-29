import { z } from 'zod';

/** The authenticated request seam `BackendClient.integrationRequest` exposes. */
export type IntegrationRequester = <T>(
  path: string,
  schema: z.ZodType<T>,
  options?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
) => Promise<T>;

/** agent-service `ScheduledCommand`, reduced to what the extension shows. */
export const routineSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  name: z.string(),
  command: z.string(),
  intervalMinutes: z.number().int(),
  status: z.enum(['ENABLED', 'PAUSED', 'DISABLED']),
  lastRunAt: z.string().nullable().optional(),
  nextRunAt: z.string(),
});

export type Routine = z.infer<typeof routineSchema>;

/** agent-service `DevicePublic`, reduced. A routine runs on one paired device. */
export const pairedDeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  hostname: z.string(),
  status: z.string(),
  lastSeenAt: z.string().nullable().optional(),
});

export type PairedDevice = z.infer<typeof pairedDeviceSchema>;

export const pairedDevicePageSchema = z.object({ data: z.array(pairedDeviceSchema) });

/** workspace-service `WorkspaceConnector`, reduced. */
export const reviewConnectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  status: z.string(),
  permissionLevel: z.string(),
});

export type ReviewConnector = z.infer<typeof reviewConnectorSchema>;

export const reviewConnectorPageSchema = z.object({ data: z.array(reviewConnectorSchema) });

/** workspace-service `WorkspaceAction` after draft or approval, reduced. */
export const workspaceActionSchema = z.object({
  id: z.string(),
  status: z.string(),
  errorMessage: z.string().nullable().optional(),
  result: z
    .object({ url: z.string().optional(), errorMessage: z.string().optional() })
    .nullable()
    .optional(),
});

export type WorkspaceAction = z.infer<typeof workspaceActionSchema>;
