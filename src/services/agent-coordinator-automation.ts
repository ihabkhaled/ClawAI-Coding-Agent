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
      templates: () => new VscodeWorkflowStore(deps.studio().files).listTemplates(),
      run: (content) => deps.runAgent({ content, contextMode: 'none' }),
    }),
    startScheduler: () => {
      // A red pull request's "fix it" starts a run the same way a due task
      // does: in a fresh conversation, from a prompt that carries the logs.
      deps
        .studio()
        .pullRequests.monitor.bindFix((prompt) =>
          deps.runAgent({ content: prompt, contextMode: 'none' }),
        );
      return deps.studio().schedules.start(async (task) => {
        if (!deps.studio().state.snapshot.connected) return;
        await deps.runAgent({ content: task.prompt, contextMode: 'none' });
      });
    },
  };
}
