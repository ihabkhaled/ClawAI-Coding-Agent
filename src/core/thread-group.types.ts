import type { ChatThread } from '../backend/contracts';

/** Which group each thread was filed into, keyed by thread id. */
export type ThreadGroupAssignments = Record<string, string>;

/** The history list arranged into groups, with the unfiled left over. */
export interface GroupedThreads {
  groups: { name: string; threads: ChatThread[] }[];
  ungrouped: ChatThread[];
}
