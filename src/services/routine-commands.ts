import * as vscode from 'vscode';

import { routineClient } from '../backend/routine-client';
import {
  parseRunnerLabels,
  planPromptRoutine,
  planRoutine,
  toggledRoutineStatus,
} from '../core/routine';

import type { IntegrationDependencies } from './integration-commands.types';
import type { Routine } from '../backend/integration-contracts';
import type { RoutineRefusal } from '../core/routine.types';

function refusalMessage(refusal: RoutineRefusal): string {
  switch (refusal) {
    case 'device':
      return vscode.l10n.t('Pick a paired device for the routine.');
    case 'name':
      return vscode.l10n.t('A routine name must be 1 to 128 characters.');
    case 'command':
      return vscode.l10n.t('A routine command must be 1 to 4096 characters.');
    case 'prompt':
      return vscode.l10n.t('A routine prompt must be 1 to 8000 characters.');
    case 'model':
      return vscode.l10n.t('A model reference must be at most 128 characters.');
    case 'repo':
      return vscode.l10n.t('The repository must be a workspace folder name, not a path.');
    case 'labels':
      return vscode.l10n.t(
        'Runner labels are up to 16 lower-case names of letters, digits, dots, dashes or underscores.',
      );
    default:
      return vscode.l10n.t('The interval must be a whole number of minutes from 5 to 10080.');
  }
}

function statusLabel(routine: Routine): string {
  if (routine.status === 'ENABLED') return vscode.l10n.t('Enabled');
  if (routine.status === 'PAUSED') return vscode.l10n.t('Paused');
  return vscode.l10n.t('Disabled');
}

async function createRoutine(deps: IntegrationDependencies): Promise<void> {
  const command = {
    label: vscode.l10n.t('Shell command on a paired device'),
    prompt: false,
  };
  const prompt = {
    label: vscode.l10n.t('Agent prompt on a runner'),
    detail: vscode.l10n.t(
      'Runs on an online runner with matching labels, even while this editor is closed.',
    ),
    prompt: true,
  };
  const kind = await vscode.window.showQuickPick([command, prompt], {
    title: vscode.l10n.t('What should the routine run?'),
  });
  if (kind === undefined) return;
  await (kind.prompt ? createPromptRoutine(deps) : createCommandRoutine(deps));
}

async function askInterval(): Promise<number | undefined> {
  const minutes = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('Run every how many minutes?'),
    value: '60',
  });
  return minutes === undefined ? undefined : Number(minutes);
}

/** F099: a prompt routine, run through the headless SDK on a matching runner. */
async function createPromptRoutine(deps: IntegrationDependencies): Promise<void> {
  const name = await vscode.window.showInputBox({ prompt: vscode.l10n.t('Routine name') });
  if (name === undefined) return;
  const prompt = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('Prompt the runner sends to the agent'),
  });
  if (prompt === undefined) return;
  const model = await vscode.window.showInputBox({
    prompt: vscode.l10n.t(
      'Model as PROVIDER/model, for example GEMINI/gemini-2.5-flash (optional)',
    ),
  });
  if (model === undefined) return;
  const repoRef = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('Workspace folder name the runner must have open (optional)'),
  });
  if (repoRef === undefined) return;
  const labelText = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('Runner labels, separated by commas (optional)'),
  });
  if (labelText === undefined) return;
  const runnerLabels = parseRunnerLabels(labelText);
  if (runnerLabels === undefined) {
    await vscode.window.showErrorMessage(refusalMessage('labels'));
    return;
  }
  const minutes = await askInterval();
  if (minutes === undefined) return;
  const plan = planPromptRoutine({
    name,
    prompt,
    model,
    repoRef,
    runnerLabels,
    intervalMinutes: minutes,
  });
  if (!plan.ok) {
    await vscode.window.showErrorMessage(refusalMessage(plan.refusal));
    return;
  }
  const created = await routineClient.createPrompt(deps.request(), plan.request);
  await vscode.window.showInformationMessage(vscode.l10n.t('Routine created: {0}', created.name));
}

async function createCommandRoutine(deps: IntegrationDependencies): Promise<void> {
  const devices = await routineClient.devices(deps.request());
  if (devices.length === 0) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('No paired device. Pair the ClawAI desktop agent first; routines run there.'),
    );
    return;
  }
  const device = await vscode.window.showQuickPick(
    devices.map((entry) => ({ label: entry.name, description: entry.hostname, id: entry.id })),
    { title: vscode.l10n.t('Routine: pick the device that runs it') },
  );
  if (device === undefined) return;
  const name = await vscode.window.showInputBox({ prompt: vscode.l10n.t('Routine name') });
  if (name === undefined) return;
  const command = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('Command the device runs (risk-checked and approval-gated there)'),
  });
  if (command === undefined) return;
  const minutes = await askInterval();
  if (minutes === undefined) return;
  const plan = planRoutine({
    deviceId: device.id,
    name,
    command,
    intervalMinutes: minutes,
  });
  if (!plan.ok) {
    await vscode.window.showErrorMessage(refusalMessage(plan.refusal));
    return;
  }
  const created = await routineClient.create(deps.request(), plan.request);
  await vscode.window.showInformationMessage(vscode.l10n.t('Routine created: {0}', created.name));
}

async function actOnRoutine(deps: IntegrationDependencies, routine: Routine): Promise<void> {
  const toggle = routine.status === 'ENABLED' ? vscode.l10n.t('Pause') : vscode.l10n.t('Resume');
  const remove = vscode.l10n.t('Delete');
  const choice = await vscode.window.showQuickPick([toggle, remove], { title: routine.name });
  if (choice === toggle) {
    await routineClient.setStatus(deps.request(), routine.id, toggledRoutineStatus(routine.status));
  } else if (choice === remove) {
    await routineClient.remove(deps.request(), routine.id);
  }
}

async function manage(deps: IntegrationDependencies): Promise<void> {
  if (!deps.connected()) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('Connect to ClawAI to manage routines.'),
    );
    return;
  }
  const routines = await routineClient.list(deps.request());
  const createItem = { label: vscode.l10n.t('$(add) New routine…'), routine: undefined };
  const picked = await vscode.window.showQuickPick(
    [
      createItem,
      ...routines.map((routine) => ({
        label: routine.name,
        description: `${statusLabel(routine)} · ${vscode.l10n.t('every {0} min', routine.intervalMinutes)}${
          routine.kind === 'PROMPT' ? ` · ${vscode.l10n.t('Prompt on a runner')}` : ''
        }`,
        detail: routine.command,
        routine,
      })),
    ],
    { title: vscode.l10n.t('Cloud routines') },
  );
  if (picked === undefined) return;
  if (picked.routine === undefined) {
    await createRoutine(deps);
    return;
  }
  await actOnRoutine(deps, picked.routine);
}

/** `clawAI.manageRoutines`: list, create, pause, resume and delete cloud routines. */
export async function manageRoutines(deps: IntegrationDependencies): Promise<void> {
  try {
    await manage(deps);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(vscode.l10n.t('Routine request failed: {0}', reason));
  }
}
