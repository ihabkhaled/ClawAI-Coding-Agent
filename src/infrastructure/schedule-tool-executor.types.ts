import type { SchedulePlan, ScheduleRequest, ScheduledTask } from '../core/scheduled-task.types';

/** What the schedule tool needs from the scheduler. */
export interface SchedulePort {
  create(request: ScheduleRequest): Promise<SchedulePlan>;
  list(): readonly ScheduledTask[];
  remove(id: string): Promise<boolean>;
}
