import { z } from 'zod';

import { visibleThreads } from './thread-list';

import type { GroupedThreads, ThreadGroupAssignments } from './thread-group.types';
import type { ChatThread } from '../backend/contracts';

/** A group name is a label a person typed, not an identifier. */
export const threadGroupNameSchema = z.string().trim().min(1).max(60);

/** How many groups one workspace may have before the sidebar stops being a sidebar. */
export const MAX_THREAD_GROUPS = 50;

export const threadGroupAssignmentsSchema = z.record(z.string(), threadGroupNameSchema);

/**
 * The history list, arranged into the groups a person put threads into.
 *
 * Groups come first, alphabetically, and ungrouped conversations follow. A
 * group is a deliberate act; an ungrouped conversation is merely one nobody
 * has filed yet, and putting the deliberate thing first is what makes the
 * grouping worth doing.
 *
 * Alphabetical rather than by recency: a group's position should not move
 * because somebody replied in it. A list that reorders itself is a list you
 * have to re-read.
 */
export function groupedThreads(
  threads: readonly ChatThread[],
  assignments: ThreadGroupAssignments,
): GroupedThreads {
  const visible = visibleThreads(threads);
  const byGroup = new Map<string, ChatThread[]>();
  const ungrouped: ChatThread[] = [];
  for (const thread of visible) {
    const group = assignments[thread.id];
    if (group === undefined) {
      ungrouped.push(thread);
      continue;
    }
    byGroup.set(group, [...(byGroup.get(group) ?? []), thread]);
  }
  const groups = [...byGroup.entries()]
    .map(([name, members]) => ({ name, threads: members }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return { groups, ungrouped };
}

/** Every group name currently in use, so a picker can offer them. */
export function existingGroupNames(assignments: ThreadGroupAssignments): string[] {
  return [...new Set(Object.values(assignments))].sort((left, right) => left.localeCompare(right));
}

/**
 * The assignments after filing a thread, or removing it from its group.
 *
 * Removal deletes the key rather than storing an empty string: a record that
 * remembers every thread ever ungrouped grows forever and answers no question.
 *
 * Assignments for threads that no longer exist are dropped on every write.
 * Nothing else prunes them, and a deleted conversation should not keep a group
 * alive in the picker.
 */
export function assignThreadToGroup(
  assignments: ThreadGroupAssignments,
  threads: readonly ChatThread[],
  threadId: string,
  group: string | undefined,
): ThreadGroupAssignments {
  const live = new Set(threads.map((thread) => thread.id));
  const next: ThreadGroupAssignments = {};
  for (const [id, name] of Object.entries(assignments)) {
    if (id !== threadId && live.has(id)) next[id] = name;
  }
  if (group !== undefined && live.has(threadId)) next[threadId] = group;
  return next;
}
