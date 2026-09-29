import type { ScheduledTask } from '../core/scheduled-task.types';

/** Where the schedule survives a restart. */
export interface ScheduleStorePort {
  read(): unknown;
  write(tasks: readonly ScheduledTask[]): Promise<void>;
}

/** One cancellable wake-up. */
export interface TimerPort {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

/** Starts the agent for a task that has come due. */
export type ScheduledTaskRunner = (task: ScheduledTask) => Promise<void>;
