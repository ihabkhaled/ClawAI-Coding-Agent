import type { ChatThread } from '../backend/contracts';
import type { ThreadGroupAssignments } from '../core/thread-group.types';

/** Which group the user chose, including the choice of none. */
export type GroupChoice = { kind: 'existing'; name: string } | { kind: 'new' } | { kind: 'none' };

/** What grouping a conversation needs to reach. */
export interface GroupConversationDependencies {
  readonly threads: () => readonly ChatThread[];
  readonly assignments: () => ThreadGroupAssignments;
  readonly save: (assignments: ThreadGroupAssignments) => Promise<void>;
}
