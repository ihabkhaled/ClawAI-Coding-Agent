import { threadGroupAssignmentsSchema } from '../core/thread-group';

import type { WorkspaceMemento } from './thread-group-store.types';
import type { ThreadGroupAssignments } from '../core/thread-group.types';

/** Where the assignments live. Workspace-scoped: a group is about this project. */
export const THREAD_GROUPS_KEY = 'clawAI.threadGroups';

/**
 * Which conversation belongs to which group.
 *
 * Stored on this machine, not on the server, because the server has no notion
 * of a group and inventing one client-side that looked shared would be a lie
 * the first time the user opened the same account elsewhere.
 *
 * A stored value that no longer parses is treated as empty rather than
 * repaired. These are labels, not data — losing them costs a minute of
 * refiling, while half-restoring them leaves a list nobody can trust.
 */
export class ThreadGroupStore {
  constructor(private readonly memento: WorkspaceMemento) {}

  read(): ThreadGroupAssignments {
    return threadGroupAssignmentsSchema.safeParse(this.memento.get(THREAD_GROUPS_KEY)).data ?? {};
  }

  async write(assignments: ThreadGroupAssignments): Promise<void> {
    await this.memento.update(THREAD_GROUPS_KEY, assignments);
  }
}
