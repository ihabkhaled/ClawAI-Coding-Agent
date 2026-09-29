import { randomUUID } from 'node:crypto';

import {
  afterRun,
  dueTasks,
  nextDelay,
  planScheduledTask,
  restoreTasks,
} from '../core/scheduled-task';

import type {
  ScheduledTaskRunner,
  ScheduleStorePort,
  TimerPort,
} from './scheduled-task-service.types';
import type { SchedulePlan, ScheduleRequest, ScheduledTask } from '../core/scheduled-task.types';

/**
 * Timed and recurring tasks for this workspace.
 *
 * Exactly one timer exists, aimed at the soonest task and never longer than a
 * day, so the cost of a schedule is one sleeping callback rather than a poll.
 * The timer is cleared whenever the schedule changes and on dispose, and a
 * repeating task removes itself after `maxRuns`, so nothing here runs forever.
 *
 * A task is persisted as already advanced before its runner starts. A crash
 * mid-run therefore costs one run rather than re-firing it on every restart.
 */
export class ScheduledTaskService {
  private tasks: readonly ScheduledTask[] = [];
  private handle: unknown;
  private runner: ScheduledTaskRunner | undefined;
  private disposed = false;

  constructor(
    private readonly store: ScheduleStorePort,
    private readonly timers: TimerPort,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = () => randomUUID().slice(0, 8),
    private readonly onError: (task: ScheduledTask, error: unknown) => void = () => undefined,
  ) {}

  /** Loads the saved schedule and begins waiting. The runner is what makes a task do anything. */
  async start(runner: ScheduledTaskRunner): Promise<void> {
    this.runner = runner;
    this.tasks = restoreTasks(this.store.read(), this.now());
    await this.store.write(this.tasks);
    this.arm();
  }

  list(): readonly ScheduledTask[] {
    return this.tasks;
  }

  async create(request: ScheduleRequest): Promise<SchedulePlan> {
    const plan = planScheduledTask(request, this.tasks.length, this.now(), this.newId());
    if (!plan.planned) return plan;
    this.tasks = [...this.tasks, plan.task];
    await this.store.write(this.tasks);
    this.arm();
    return plan;
  }

  async remove(id: string): Promise<boolean> {
    const remaining = this.tasks.filter((task) => task.id !== id);
    if (remaining.length === this.tasks.length) return false;
    this.tasks = remaining;
    await this.store.write(this.tasks);
    this.arm();
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.disarm();
  }

  private disarm(): void {
    if (this.handle === undefined) return;
    this.timers.clear(this.handle);
    this.handle = undefined;
  }

  private arm(): void {
    this.disarm();
    if (this.disposed || this.runner === undefined) return;
    const delay = nextDelay(this.tasks, this.now());
    if (delay === undefined) return;
    this.handle = this.timers.set(() => {
      this.handle = undefined;
      void this.fire();
    }, delay);
  }

  private async fire(): Promise<void> {
    const now = this.now();
    const due = dueTasks(this.tasks, now);
    if (due.length > 0) {
      const dueIds = new Set(due.map((task) => task.id));
      this.tasks = this.tasks.flatMap((task) => {
        if (!dueIds.has(task.id)) return [task];
        const next = afterRun(task, now);
        return next === undefined ? [] : [next];
      });
      await this.store.write(this.tasks);
    }
    this.arm();
    for (const task of due) await this.run(task);
  }

  private async run(task: ScheduledTask): Promise<void> {
    if (this.runner === undefined || this.disposed) return;
    try {
      await this.runner(task);
    } catch (error) {
      this.onError(task, error);
    }
  }
}
