import { describe, expect, it, vi } from 'vitest';

import { AgentTaskService } from '../../src/services/agent-task-service';

import type { AgentTask } from '../../src/core/agent-tasks';

function task(overrides: Partial<AgentTask> = {}): AgentTask {
  return { id: 'read-audit', title: 'Read the audit', status: 'pending', ...overrides };
}

function service() {
  const update = vi.fn();
  return { update, tasks: new AgentTaskService({ update }) };
}

describe('AgentTaskService', () => {
  // The list is replaced wholesale: an agent restates what it is doing far more
  // reliably than it emits a correct diff against a list it cannot see.
  it('replaces the list rather than merging into it', () => {
    const { tasks } = service();

    tasks.replace([task({ id: 'a' }), task({ id: 'b' })]);
    const progress = tasks.replace([task({ id: 'c', status: 'done' })]);

    expect(progress.total).toBe(1);
    expect(progress.tasks[0]?.id).toBe('c');
  });

  // A list the agent keeps for itself is a list nobody can check against what
  // is actually happening.
  it('publishes every change into the extension state', () => {
    const { tasks, update } = service();

    tasks.replace([task({ status: 'in-progress' })]);

    expect(update).toHaveBeenCalledWith({
      tasks: [expect.objectContaining({ status: 'in-progress' })],
    });
  });

  it('reports progress and the task in flight', () => {
    const { tasks } = service();

    const progress = tasks.replace([
      task({ id: 'a', status: 'done' }),
      task({ id: 'b', status: 'in-progress', title: 'Write the tests' }),
      task({ id: 'c', status: 'blocked' }),
    ]);

    expect(progress).toMatchObject({ total: 3, done: 1, blocked: 1 });
    expect(progress.current?.title).toBe('Write the tests');
  });

  it('clears on a boundary, because the tasks describe a workspace that has gone', () => {
    const { tasks, update } = service();

    tasks.replace([task()]);
    tasks.clear();

    expect(tasks.current().total).toBe(0);
    expect(update).toHaveBeenLastCalledWith({ tasks: [] });
  });
});
