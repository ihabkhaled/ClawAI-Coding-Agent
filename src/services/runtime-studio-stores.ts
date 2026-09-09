import { AgentTaskService } from './agent-task-service';
import { FindingsService } from './findings-service';

import type { AgentTask } from '../core/agent-tasks';
import type { Finding } from '../core/findings';

interface RunScopedStatePort {
  update(patch: { findings: readonly Finding[] } | { tasks: readonly AgentTask[] }): void;
}

export interface RunScopedStores {
  readonly findings: FindingsService;
  readonly tasks: AgentTaskService;
  /** Everything a workspace change invalidates at once. */
  clear(): void;
}

/**
 * The stores whose contents describe one workspace and one run.
 *
 * Both are cleared by the same event for the same reason — a finding names a
 * path and a task describes work in a tree that is no longer open — so they are
 * created and forgotten together rather than by two calls a future change can
 * forget to keep in step.
 */
export function createRunScopedStores(state: RunScopedStatePort): RunScopedStores {
  const findings = new FindingsService(state);
  const tasks = new AgentTaskService(state);
  return {
    findings,
    tasks,
    clear: () => {
      findings.clear();
      tasks.clear();
    },
  };
}
