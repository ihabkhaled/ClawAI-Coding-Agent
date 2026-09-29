import * as vscode from 'vscode';

import { remoteSessionClient, type RemoteRequester } from '../backend/remote-session-client';
import { buildCloudSessionCommand, isCloudTaskFinished } from '../core/cloud-session-command';
import { redactText } from '../core/redaction';

import {
  CLOUD_OUTPUT_TAIL_CHARACTERS,
  CLOUD_WATCH_POLICY,
} from './remote-session-commands.constants';

import type { CloudWatchPolicy, RemoteSessionDependencies } from './remote-session-commands.types';
import type { CloudTask, RunnerRepo, RunnerSession } from '../backend/remote-session-contracts';

async function pickRunner(request: RemoteRequester): Promise<RunnerSession | undefined> {
  const runners = await remoteSessionClient.connectedRunners(request);
  if (runners.length === 0) {
    // The honest boundary of F098: ClawAI provisions no machines. A session
    // runs only on a runner the user registered themselves.
    await vscode.window.showWarningMessage(
      vscode.l10n.t(
        'No runner is online. ClawAI has no hosted runners: start the ClawAI agent on a machine you own, then try again.',
      ),
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    runners.map((runner) => ({ label: runner.hostname, description: runner.platform, runner })),
    { placeHolder: vscode.l10n.t('Pick a runner') },
  );
  return picked?.runner;
}

async function pickRepo(
  request: RemoteRequester,
  runner: RunnerSession,
): Promise<RunnerRepo | undefined> {
  const repos = await remoteSessionClient.runnerRepos(request, runner.id);
  if (repos.length === 0) {
    await vscode.window.showWarningMessage(
      vscode.l10n.t('This runner has reported no repositories.'),
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    repos.map((repo) => ({
      label: repo.name,
      description: repo.repoPath,
      detail: repo.branch ?? '',
      repo,
    })),
    { placeHolder: vscode.l10n.t('Pick a repository') },
  );
  return picked?.repo;
}

async function askCommand(repo: RunnerRepo): Promise<string | undefined> {
  const branch = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('Branch to work on'),
    value: repo.branch ?? '',
  });
  if (branch === undefined) return undefined;
  const task = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('Command to run on the runner'),
  });
  if (task === undefined) return undefined;
  const built = buildCloudSessionCommand({ branch: branch.trim(), task });
  if (!built.ok) {
    await vscode.window.showErrorMessage(
      vscode.l10n.t('That branch name or command cannot be sent to a runner.'),
    );
    return undefined;
  }
  return built.command;
}

function report(output: vscode.OutputChannel, task: CloudTask): void {
  output.appendLine(vscode.l10n.t('Cloud session {0}: {1}', task.id, task.status));
  if (!isCloudTaskFinished(task.status)) return;
  for (const text of [task.stdout, task.stderr, task.rejectionReason]) {
    if (typeof text === 'string' && text.length > 0) {
      output.appendLine(redactText(text.slice(-CLOUD_OUTPUT_TAIL_CHARACTERS)));
    }
  }
}

/**
 * Follows a dispatched session until it finishes, the user stops watching, or
 * the poll budget runs out. Each status change is written once.
 */
export async function watchCloudTask(
  read: () => Promise<CloudTask>,
  output: vscode.OutputChannel,
  token: vscode.CancellationToken,
  policy: CloudWatchPolicy = CLOUD_WATCH_POLICY,
): Promise<CloudTask | undefined> {
  let lastStatus = '';
  for (let poll = 0; poll < policy.maxPolls && !token.isCancellationRequested; poll += 1) {
    const task = await read();
    if (task.status !== lastStatus) {
      lastStatus = task.status;
      report(output, task);
    }
    if (isCloudTaskFinished(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, policy.intervalMs));
  }
  return undefined;
}

/**
 * Starts a coding session bound to a repository and branch on a runner the
 * user registered, and streams its status into an output channel. The runner
 * applies its own approval and risk policy before anything executes.
 */
export async function startCloudSession(dependencies: RemoteSessionDependencies): Promise<void> {
  const request = dependencies.request();
  const runner = await pickRunner(request);
  const repo = runner === undefined ? undefined : await pickRepo(request, runner);
  const command = repo === undefined ? undefined : await askCommand(repo);
  if (runner === undefined || repo === undefined || command === undefined) return;
  const task = await remoteSessionClient.dispatch(request, {
    sessionId: runner.id,
    workingDir: repo.repoPath,
    command,
  });
  const output = vscode.window.createOutputChannel('ClawAI Cloud Session');
  output.show(true);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('Cloud session on {0}', runner.hostname),
      cancellable: true,
    },
    (_progress, token) =>
      watchCloudTask(() => remoteSessionClient.task(request, task.id), output, token),
  );
}
