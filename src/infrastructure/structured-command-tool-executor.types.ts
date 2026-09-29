import type { ProcessSupervisorService } from '../services/process-supervisor-service';

/**
 * What a backgrounded command needs from the process supervisor.
 *
 * Narrowed to `create` so the executor cannot reach the supervisor's control
 * operations, which belong to `workspace.process` and its own policy.
 */
export interface BackgroundCommandPort {
  readonly supervisor: Pick<ProcessSupervisorService, 'create'>;
  readonly ownerId: () => string;
}
