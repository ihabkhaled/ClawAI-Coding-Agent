import { remoteJobClient } from '../backend/remote-job-client';

import type { BackendClient } from '../backend/backend-client';
import type { RemoteJobPort } from '../backend/remote-job.types';

/** Remote jobs bound to whichever backend client is current, so signing in again reaches them. */
export function backendRemoteJobs(backend: () => BackendClient): RemoteJobPort {
  const client = (): RemoteJobPort => remoteJobClient(backend().integrationRequest);
  return {
    list: () => client().list(),
    create: (request) => client().create(request),
    trigger: (id, idempotencyKey) => client().trigger(id, idempotencyKey),
    status: (commandId) => client().status(commandId),
  };
}
