import * as vscode from 'vscode';

import { savedWorkflowRunPrompt } from '../core/saved-workflow-prompt';
import { workflowTemplateRunPrompt } from '../core/workflow-template';

import { savedWorkflowPicks } from './saved-workflow-picks';

import type { ScheduledTaskService } from './scheduled-task-service';
import type { SavedWorkflow } from '../core/saved-workflow';
import type { ScheduledTask } from '../core/scheduled-task.types';
import type { WorkflowTemplate } from '../core/workflow-template';

export interface AutomationDependencies {
  readonly schedules: () => ScheduledTaskService;
  readonly workflows: () => Promise<readonly SavedWorkflow[]>;
  /** User-defined workflow templates from `.clawai/workflows`. */
  readonly templates?: () => Promise<readonly WorkflowTemplate[]>;
  readonly run: (prompt: string) => Promise<void>;
}

export interface AutomationCommands {
  manageScheduledTasks(): Promise<void>;
  runSavedWorkflow(): Promise<void>;
}

function describeKind(task: ScheduledTask): string {
  const schedule = task.schedule;
  if (schedule.kind === 'interval') return vscode.l10n.t('every {0} min', schedule.everyMinutes);
  if (schedule.kind === 'cron') return vscode.l10n.t('on schedule {0}', schedule.expression);
  return vscode.l10n.t('once');
}

function describeTask(task: ScheduledTask): string {
  const when = new Date(task.nextRunAt).toLocaleString();
  const kind = describeKind(task);
  return `${kind} · ${when} · ${String(task.runs)}/${String(task.maxRuns)}`;
}

/** Lists scheduled runs and deletes the one a person picks. */
async function manageScheduledTasks(deps: AutomationDependencies): Promise<void> {
  const schedules = deps.schedules();
  const tasks = schedules.list();
  if (tasks.length === 0) {
    await vscode.window.showInformationMessage(vscode.l10n.t('No scheduled tasks.'));
    return;
  }
  const picked = await vscode.window.showQuickPick(
    tasks.map((task) => ({ label: task.label, description: describeTask(task), id: task.id })),
    { title: vscode.l10n.t('Scheduled tasks: pick one to delete') },
  );
  if (picked === undefined) return;
  await schedules.remove(picked.id);
}

/**
 * Starts a template. A template that declares a request prompt asks for the
 * request with the author's own wording; dismissing that box cancels the run.
 */
async function runTemplate(
  deps: AutomationDependencies,
  template: WorkflowTemplate,
): Promise<void> {
  if (template.requestPrompt === undefined) {
    await deps.run(workflowTemplateRunPrompt(template));
    return;
  }
  const request = await vscode.window.showInputBox({
    title: template.name,
    prompt: template.requestPrompt,
    ignoreFocusOut: true,
  });
  if (request === undefined) return;
  await deps.run(workflowTemplateRunPrompt(template, request));
}

/** Starts a saved graph or a user-defined template the person picks. */
async function runSavedWorkflow(deps: AutomationDependencies): Promise<void> {
  const [workflows, templates] = await Promise.all([
    deps.workflows(),
    deps.templates?.() ?? Promise.resolve([]),
  ]);
  const picks = savedWorkflowPicks(workflows, templates);
  if (picks.length === 0) {
    await vscode.window.showInformationMessage(vscode.l10n.t('No saved workflows.'));
    return;
  }
  const picked = await vscode.window.showQuickPick(picks, {
    title: vscode.l10n.t('Run a saved workflow'),
  });
  if (picked === undefined) return;
  if (picked.template !== undefined) {
    await runTemplate(deps, picked.template);
    return;
  }
  await deps.run(savedWorkflowRunPrompt(picked.name));
}

export function automationCommands(deps: AutomationDependencies): AutomationCommands {
  return {
    manageScheduledTasks: () => manageScheduledTasks(deps),
    runSavedWorkflow: () => runSavedWorkflow(deps),
  };
}
