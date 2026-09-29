import type { RunAgentInput } from './agent-coordinator.types';
import type { AutomationCommands } from './automation-commands';
import type { VscodeRuntimeStudio } from './vscode-runtime-studio';

export interface CoordinatorAutomationDependencies {
  /** The studio owning the schedule, the workflow files and the extension state. */
  readonly studio: () => VscodeRuntimeStudio;
  readonly runAgent: (input: RunAgentInput) => Promise<void>;
}

export interface CoordinatorAutomation {
  /** Scheduled runs and saved workflows. Starting the schedule is `startScheduler`. */
  readonly automation: AutomationCommands;
  /**
   * Begins waiting on the saved schedule. A due task is skipped while the
   * connection is down; the run it would start needs the backend.
   */
  readonly startScheduler: () => Promise<void>;
}
