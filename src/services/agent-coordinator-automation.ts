import { VscodeWorkflowStore } from '../infrastructure/vscode-workflow-store';

import { automationCommands } from './automation-commands';

import type {
  CoordinatorAutomation,
  CoordinatorAutomationDependencies,
} from './agent-coordinator-automation.types';

/** The coordinator's scheduled-task and saved-workflow wiring. */
export function coordinatorAutomation(
  deps: CoordinatorAutomationDependencies,
): CoordinatorAutomation {
  return {
    automation: automationCommands({
      schedules: () => deps.studio().schedules,
      workflows: () => new VscodeWorkflowStore(deps.studio().files).list(),
      run: (content) => deps.runAgent({ content, contextMode: 'none' }),
    }),
    startScheduler: () =>
      deps.studio().schedules.start(async (task) => {
        if (!deps.studio().state.snapshot.connected) return;
        await deps.runAgent({ content: task.prompt, contextMode: 'none' });
      }),
  };
}
