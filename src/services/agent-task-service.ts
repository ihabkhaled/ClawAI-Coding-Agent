import { summarizeTasks } from '../core/agent-tasks';

import type { AgentTask, TaskProgress } from '../core/agent-tasks';

interface TaskStatePort {
  update(patch: { tasks: readonly AgentTask[] }): void;
}

/**
 * The task list for the current run, published where a person can see it.
 *
 * The list is replaced wholesale rather than patched. An agent restates what it
 * is doing far more reliably than it emits a correct diff against a list it
 * cannot see, and a replace has no way to leave the store disagreeing with what
 * the model believes. The cost is that a stale replace can drop a task, which
 * is recoverable and visible; the cost of a wrong patch is a list that silently
 * describes work nobody is doing.
 */
export class AgentTaskService {
  private tasks: readonly AgentTask[] = [];

  constructor(private readonly state: TaskStatePort) {}

  replace(tasks: readonly AgentTask[]): TaskProgress {
    this.tasks = tasks;
    this.state.update({ tasks: this.tasks });
    return summarizeTasks(this.tasks);
  }

  current(): TaskProgress {
    return summarizeTasks(this.tasks);
  }

  /** Cleared on a boundary: the tasks describe work in a workspace that has gone. */
  clear(): void {
    this.replace([]);
  }
}
