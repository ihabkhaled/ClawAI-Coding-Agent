import type {
  remoteCommandSchema,
  remoteDevicePageSchema,
  remoteJobSchema,
  remoteTriggerSchema,
} from './remote-job.schemas';
import type { z } from 'zod';

export type RemoteJob = z.infer<typeof remoteJobSchema>;
export type RemoteCommand = z.infer<typeof remoteCommandSchema>;
export type RemoteTrigger = z.infer<typeof remoteTriggerSchema>;
export type RemoteDevice = z.infer<typeof remoteDevicePageSchema>['data'][number];

export interface RemoteJobListing {
  readonly jobs: readonly RemoteJob[];
  readonly devices: readonly RemoteDevice[];
}

export interface RemoteJobCreateRequest {
  readonly deviceId: string;
  readonly name: string;
  readonly command: string;
  readonly intervalMinutes: number;
  readonly workingDir?: string | undefined;
}

/** What the `runtime.remote` tool and the trigger command need from the backend. */
export interface RemoteJobPort {
  list(): Promise<RemoteJobListing>;
  create(request: RemoteJobCreateRequest): Promise<RemoteJob>;
  trigger(id: string, idempotencyKey: string): Promise<RemoteTrigger>;
  status(commandId: string): Promise<RemoteCommand>;
}
