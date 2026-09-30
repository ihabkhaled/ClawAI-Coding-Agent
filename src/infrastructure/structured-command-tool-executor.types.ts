import type { ProcessSupervisorService } from '../services/process-supervisor-service';

/**
 * What a backgrounded command needs from the process supervisor.
 *
 * Narrowed so the executor cannot reach the supervisor's interactive control
 * operations, which belong to `workspace.process` and its own policy. `join`
 * and `snapshot` let a yielding command wait and read what it printed;
 * `terminate` stops one whose turn was cancelled before it yielded.
 */
export interface BackgroundCommandPort {
  readonly supervisor: Pick<ProcessSupervisorService, 'create' | 'join' | 'snapshot' | 'terminate'>;
  readonly ownerId: () => string;
}
