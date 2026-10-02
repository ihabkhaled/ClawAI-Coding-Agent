import * as vscode from 'vscode';

import { remoteSessionClient } from '../backend/remote-session-client';
import { isUnsupportedRoute, orUnsupported } from '../backend/remote-session-fallback';
import { isCloudTaskFinished } from '../core/cloud-session-command';
import { redactText } from '../core/redaction';
import { runnerWorkspaceFit } from '../core/runner-workspace-fit';
import { newestFirst, outcomeOf, pollWithBackoff } from '../core/session-handoff';
import { ATTACH_BACKOFF_POLICY } from '../core/session-handoff.constants';

import { complianceLabel } from './runner-compliance-label';
import { offerFollowUp, stopSession } from './session-followup';
import { workspaceRepositoryRef } from './workspace-repository-ref';

import type { RemoteSessionDependencies } from './remote-session-commands.types';
import type {
  CloudTask,
  RunnerPolicyView,
  RunnerRepo,
  RunnerSession,
} from '../backend/remote-session-contracts';
import type { BackoffPolicy } from '../core/session-handoff.types';

const OUTPUT_TAIL = 2_000;

/** The policy verdict per connected runner; empty on an older backend or any failure. */
async function runnerVerdicts(
  dependencies: RemoteSessionDependencies,
): Promise<Map<string, RunnerPolicyView>> {
  const rows = await remoteSessionClient
    .runnerPolicy(dependencies.request())
    .catch((): RunnerPolicyView[] => []);
  return new Map(rows.map((row) => [row.id, row]));
}

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
  const verdicts = await runnerVerdicts(dependencies);
  const picked = await vscode.window.showQuickPick(
    runners.map((runner) => {
      const verdict = complianceLabel(verdicts.get(runner.id));
      return {
        label: runner.hostname,
        description: runner.status,
        ...(verdict === undefined ? {} : { detail: verdict }),
        runner,
      };
    }),
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
 * F095: warns when the runner's checkouts are not the folders open here, and
 * returns the repositories the runner reported (empty when unknown).
 */
async function warnOnWorkspaceMismatch(
  dependencies: RemoteSessionDependencies,
  runner: RunnerSession,
  output: vscode.OutputChannel,
): Promise<readonly RunnerRepo[]> {
  const repos = await remoteSessionClient
    .runnerRepos(dependencies.request(), runner.id)
    .catch((): undefined => undefined);
  const fit = runnerWorkspaceFit({
    runnerRepos: repos ?? [],
    workspaceNames: (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.name),
  });
  if (fit === 'mismatch') {
    output.appendLine(
      vscode.l10n.t(
        'None of the repositories {0} reports is open in this window, so continuing in chat cannot reach its files.',
        runner.hostname,
      ),
    );
  }
  return repos ?? [];
}

/**
 * F095: asks the backend whether the runner is still up. An older backend
 * answers 404 and is ignored; so is any other failure, because this only
 * adds a sentence to the output and must never block the attach.
 */
async function noteRunnerOffline(
  dependencies: RemoteSessionDependencies,
  runner: RunnerSession,
  output: vscode.OutputChannel,
): Promise<void> {
  const resume = await remoteSessionClient
    .runnerResume(dependencies.request(), runner.id)
    .catch((): undefined => undefined);
  if (resume?.online === false) {
    output.appendLine(vscode.l10n.t('Runner {0} is not connected now.', runner.hostname));
  }
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
  await noteRunnerOffline(dependencies, runner, output);
  const repos = await warnOnWorkspaceMismatch(dependencies, runner, output);
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
  await offerFollowUp(
    dependencies,
    latest,
    runner.hostname,
    workspaceRepositoryRef(repos.map((repo) => repo.name)),
  );
}

/** Cancels a pending or executing command on a runner the user picks. */
export async function stopRunnerSession(dependencies: RemoteSessionDependencies): Promise<void> {
  const runner = await pickRunnerSession(dependencies);
  const task =
    runner === undefined ? undefined : await pickRunnerCommand(dependencies, runner, true);
  if (task !== undefined) await stopSession(dependencies, task.id);
}
