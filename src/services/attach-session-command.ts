import * as vscode from 'vscode';

import { remoteSessionClient } from '../backend/remote-session-client';
import { isUnsupportedRoute, orUnsupported } from '../backend/remote-session-fallback';
import { isCloudTaskFinished } from '../core/cloud-session-command';
import { redactText } from '../core/redaction';
import { newestFirst, outcomeOf, pollWithBackoff } from '../core/session-handoff';
import { ATTACH_BACKOFF_POLICY } from '../core/session-handoff.constants';

import { offerFollowUp, stopSession } from './session-followup';

import type { RemoteSessionDependencies } from './remote-session-commands.types';
import type { CloudTask, RunnerSession } from '../backend/remote-session-contracts';
import type { BackoffPolicy } from '../core/session-handoff.types';

const OUTPUT_TAIL = 2_000;

/** Runners this user has, or undefined (with a message) on an older backend. */
export async function pickRunnerSession(
  dependencies: RemoteSessionDependencies,
): Promise<RunnerSession | undefined> {
  const runners = await orUnsupported(() => remoteSessionClient.allRunners(dependencies.request()));
  if (runners === undefined || runners.length === 0) {
    await vscode.window.showInformationMessage(
      runners === undefined
        ? vscode.l10n.t('This backend does not list runner sessions yet.')
        : vscode.l10n.t('No runner sessions were found for this account.'),
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    runners.map((runner) => ({ label: runner.hostname, description: runner.status, runner })),
    { placeHolder: vscode.l10n.t('Pick a runner session') },
  );
  return picked?.runner;
}

/** The commands of a runner, newest first, or undefined (with a message). */
export async function pickRunnerCommand(
  dependencies: RemoteSessionDependencies,
  runner: RunnerSession,
  onlyRunning: boolean,
): Promise<CloudTask | undefined> {
  const listed = await orUnsupported(() =>
    remoteSessionClient.sessionCommands(dependencies.request(), runner.id),
  );
  const tasks = newestFirst(listed ?? []).filter(
    (task) => !onlyRunning || !isCloudTaskFinished(task.status),
  );
  if (tasks.length === 0) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('No matching commands were found on {0}.', runner.hostname),
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    tasks.map((task) => ({
      label: (task.command ?? task.id).slice(0, 80),
      description: task.status,
      task,
    })),
    { placeHolder: vscode.l10n.t('Pick a command') },
  );
  return picked?.task;
}

function logTask(output: vscode.OutputChannel, task: CloudTask): void {
  output.appendLine(vscode.l10n.t('Session {0}: {1}', task.id, task.status));
  for (const text of [task.stdout, task.stderr]) {
    if (typeof text === 'string' && text.length > 0) {
      output.appendLine(redactText(text.slice(-OUTPUT_TAIL)));
    }
  }
}

/**
 * Read-only follow of a session: a bounded, backing-off poll of the command's
 * status and output tail. Nothing here writes to the runner. The last task
 * read is returned even when the poll gave up.
 */
export async function followSession(
  dependencies: RemoteSessionDependencies,
  first: CloudTask,
  output: vscode.OutputChannel,
  token: vscode.CancellationToken,
  policy: BackoffPolicy = ATTACH_BACKOFF_POLICY,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<CloudTask> {
  let latest = first;
  let lastStatus = '';
  await pollWithBackoff<CloudTask>({
    read: async () => {
      try {
        return await remoteSessionClient.task(dependencies.request(), first.id);
      } catch (error) {
        if (isUnsupportedRoute(error)) return { ...latest, status: 'EXPIRED' };
        throw error;
      }
    },
    isDone: (task) => isCloudTaskFinished(task.status),
    onUpdate: (task) => {
      latest = task;
      if (task.status === lastStatus) return;
      lastStatus = task.status;
      logTask(output, task);
    },
    isCancelled: () => token.isCancellationRequested,
    policy,
    sleep,
  });
  return latest;
}

/**
 * F095: attaches to a session hosted on a runner. A finished or failed one is
 * shown as it ended; a running one is followed read-only. Either can continue
 * in a chat thread.
 */
export async function attachRemoteSession(dependencies: RemoteSessionDependencies): Promise<void> {
  const runner = await pickRunnerSession(dependencies);
  const task =
    runner === undefined ? undefined : await pickRunnerCommand(dependencies, runner, false);
  if (runner === undefined || task === undefined) return;
  const output = vscode.window.createOutputChannel('ClawAI Runner Session');
  output.show(true);
  if (outcomeOf(task) !== 'running') logTask(output, task);
  const latest =
    outcomeOf(task) === 'running'
      ? await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: vscode.l10n.t('Following session on {0}', runner.hostname),
            cancellable: true,
          },
          (_progress, token) => followSession(dependencies, task, output, token),
        )
      : task;
  await offerFollowUp(dependencies, latest, runner.hostname);
}

/** Cancels a pending or executing command on a runner the user picks. */
export async function stopRunnerSession(dependencies: RemoteSessionDependencies): Promise<void> {
  const runner = await pickRunnerSession(dependencies);
  const task =
    runner === undefined ? undefined : await pickRunnerCommand(dependencies, runner, true);
  if (task !== undefined) await stopSession(dependencies, task.id);
}
