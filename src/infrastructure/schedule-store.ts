import { SCHEDULED_TASKS_STATE_KEY } from '../core/scheduled-task.constants';

import type { ScheduledTask } from '../core/scheduled-task.types';
import type { ScheduleStorePort, TimerPort } from '../services/scheduled-task-service.types';

/** The slice of a VS Code Memento the schedule needs. */
export interface ScheduleMemento {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** The schedule, kept in workspace state so it survives a restart. */
export class WorkspaceScheduleStore implements ScheduleStorePort {
  constructor(private readonly memento: ScheduleMemento) {}

  read(): unknown {
    return this.memento.get(SCHEDULED_TASKS_STATE_KEY);
  }

  async write(tasks: readonly ScheduledTask[]): Promise<void> {
    await this.memento.update(SCHEDULED_TASKS_STATE_KEY, tasks);
  }
}

/** One real timer at a time; the service owns clearing it. */
export const nodeTimers: TimerPort = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};
