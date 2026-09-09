import { describe, expect, it } from 'vitest';

import { agentTaskListSchema, summarizeTasks } from '../../src/core/agent-tasks';

import type { AgentTask } from '../../src/core/agent-tasks';

function task(overrides: Partial<AgentTask> = {}): AgentTask {
  return { id: 'read-audit', title: 'Read the audit', status: 'pending', ...overrides };
}

describe('agentTaskListSchema', () => {
  it('accepts a list with one task in progress', () => {
    const parsed = agentTaskListSchema.safeParse([
      task({ id: 'a', status: 'done' }),
      task({ id: 'b', status: 'in-progress' }),
      task({ id: 'c' }),
    ]);

    expect(parsed.success).toBe(true);
  });

  // A list where three things are in progress is a list of intentions, not a
  // record of work.
  it('refuses more than one task in progress', () => {
    const parsed = agentTaskListSchema.safeParse([
      task({ id: 'a', status: 'in-progress' }),
      task({ id: 'b', status: 'in-progress' }),
    ]);

    expect(parsed.success).toBe(false);
  });

  it('refuses duplicate ids, which would make an update ambiguous', () => {
    expect(agentTaskListSchema.safeParse([task(), task()]).success).toBe(false);
  });

  it('accepts an empty list, which is how a finished run clears itself', () => {
    expect(agentTaskListSchema.safeParse([]).success).toBe(true);
  });

  it('carries a note for a blocked task', () => {
    const parsed = agentTaskListSchema.parse([
      task({ status: 'blocked', note: 'Waiting on the backend contract' }),
    ]);

    expect(parsed[0]?.note).toBe('Waiting on the backend contract');
  });
});

describe('summarizeTasks', () => {
  it('counts progress and names the task in flight', () => {
    const progress = summarizeTasks([
      task({ id: 'a', status: 'done' }),
      task({ id: 'b', status: 'in-progress', title: 'Write the tests' }),
      task({ id: 'c', status: 'blocked' }),
      task({ id: 'd' }),
    ]);

    expect(progress).toMatchObject({ total: 4, done: 1, blocked: 1 });
    expect(progress.current?.title).toBe('Write the tests');
  });

  it('reports no current task when nothing is in progress', () => {
    expect(summarizeTasks([task()]).current).toBeUndefined();
    expect(summarizeTasks([]).current).toBeUndefined();
  });

  // The order the agent wrote is the order it intends to work. Sorting by state
  // would move a task the moment it started, which is when a reader is looking
  // at it.
  it('keeps the order it was given rather than grouping by status', () => {
    const progress = summarizeTasks([
      task({ id: 'a', status: 'done' }),
      task({ id: 'b' }),
      task({ id: 'c', status: 'in-progress' }),
    ]);

    expect(progress.tasks.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });
});
