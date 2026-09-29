import {
  remoteCommandSchema,
  remoteDevicePageSchema,
  remoteJobListSchema,
  remoteJobSchema,
  remoteTriggerSchema,
} from './remote-job.schemas';

import type { IntegrationRequester } from './integration-contracts';
import type { RemoteJobPort } from './remote-job.types';

/**
 * Remote jobs (F029) over the agent service's scheduled-command routes.
 *
 * A job is a named command on one of the user's paired devices. Triggering
 * fires it now through `POST …/:id/trigger`, carrying an idempotency key so a
 * retried request returns the command the first one created instead of
 * running the job twice. Every route is owner-scoped on the server.
 */
export function remoteJobClient(request: IntegrationRequester): RemoteJobPort {
  return {
    list: async () => {
      const [jobs, devices] = await Promise.all([
        request('/agent/scheduled-commands', remoteJobListSchema),
        request('/agent/devices?status=ACTIVE&page=1&pageSize=50', remoteDevicePageSchema),
      ]);
      return { jobs, devices: devices.data };
    },
    create: (job) =>
      request('/agent/scheduled-commands', remoteJobSchema, {
        method: 'POST',
        body: {
          deviceId: job.deviceId,
          name: job.name,
          command: job.command,
          intervalMinutes: job.intervalMinutes,
          ...(job.workingDir === undefined ? {} : { workingDir: job.workingDir }),
        },
      }),
    trigger: (id, idempotencyKey) =>
      request(`/agent/scheduled-commands/${encodeURIComponent(id)}/trigger`, remoteTriggerSchema, {
        method: 'POST',
        body: { idempotencyKey },
      }),
    status: (commandId) =>
      request(`/agent/commands/${encodeURIComponent(commandId)}`, remoteCommandSchema),
  };
}
