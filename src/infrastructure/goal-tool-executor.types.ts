import type { RunGoal } from '../core/run-goal.types';

/** Where this run's goal lives, for the length of the run. */
export interface RunGoalPort {
  read(): RunGoal | undefined;
  write(goal: RunGoal): void;
}
