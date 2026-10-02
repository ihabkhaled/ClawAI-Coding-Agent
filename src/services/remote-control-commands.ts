import os from 'node:os';

import * as vscode from 'vscode';

import {
  agentRemoteClient,
  type AgentHostIdentity,
  type AgentRegistration,
} from '../backend/agent-remote-client';
import { agentOperationErrorMessage } from '../backend/backend-error-message';
import { devicePairingClient, type PairingDeviceHint } from '../backend/device-pairing-client';
import { sandboxedRunnerExecutor } from '../infrastructure/runner-command-executor';
import { VscodeCommandSandbox } from '../infrastructure/vscode-command-sandbox';

import { runDevicePairing } from './device-pairing-flow';
import { showPairingPanel } from './pairing-qr-panel';
import { RemoteCommandLoop } from './remote-command-loop';
import {
  PAIRED_DEVICE_SECRET_KEY,
  REMOTE_APPROVAL_TIMEOUT_MS,
} from './remote-control-commands.constants';
import { runnerPromptExecutor } from './runner-prompt-executor';

import type { DevicePairingOutcome } from './device-pairing-flow.types';
import type {
  RemoteCommandApproval,
  RemoteCommandSource,
  RemoteLoopState,
} from './remote-command-loop.types';
import type { BackendClient } from '../backend/backend-client';
import type { RunnerApprovalPolicy } from '../core/runner-prompt-policy.types';
import type { OutputLogger } from '../infrastructure/output-logger';
import type { AgentApprovalRequest } from '../sdk/workspace-toolkit.types';

interface RemoteControlDependencies {
  readonly backend: () => BackendClient;
  readonly secrets: vscode.SecretStorage;
  readonly logger: OutputLogger;
  readonly version: string;
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * F096 remote control, F097 phone pairing and F100 runner registration.
 * One loop at a time: this editor is either a remote-control target or a
 * runner, never both, so one approval prompt can never race another.
 */
export function registerRemoteControlCommands(
  deps: RemoteControlDependencies,
): vscode.Disposable[] {
  let loop: RemoteCommandLoop | null = null;
  const stop = (): void => {
    loop?.stop();
    loop = null;
  };
  /** `runnerPolicy` is set for a runner (F100) and undefined for remote control (F096). */
  const begin = async (
    register: (host: AgentHostIdentity) => Promise<AgentRegistration>,
    runnerPolicy: RunnerApprovalPolicy | undefined,
  ): Promise<string | undefined> => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!vscode.workspace.isTrusted || root === undefined) {
      await vscode.window.showWarningMessage(
        vscode.l10n.t('Open a trusted workspace folder before accepting remote commands.'),
      );
      return undefined;
    }
    stop();
    let registration: AgentRegistration;
    const host = hostIdentity(deps.version);
    try {
      registration = await register(host);
    } catch (error: unknown) {
      await vscode.window.showErrorMessage(agentOperationErrorMessage(error));
      return undefined;
    }
    const current = new RemoteCommandLoop({
      source: commandSource(deps.backend, registration, runnerPolicy !== undefined, host),
      approve: approveLocally,
      ...(runnerPolicy === undefined ? {} : { runPrompt: promptRunner(deps, runnerPolicy) }),
      execute: sandboxedRunnerExecutor(new VscodeCommandSandbox(), workspaceRoot),
      workspaceRoot,
      sleep: abortableSleep,
      report: (message) => {
        deps.logger.info(message);
      },
      stateChanged: (state) => {
        void announceFailure(state);
      },
    });
    loop = current;
    void current.start();
    return registration.sessionId;
  };

  return [
    { dispose: stop },
    vscode.commands.registerCommand('clawAI.remoteControl.start', async () => {
      const started = await begin(
        (host) => agentRemoteClient.registerSession(deps.backend().remoteRequest, host),
        undefined,
      );
      if (started !== undefined) {
        await vscode.window.showInformationMessage(
          vscode.l10n.t(
            'Remote control is on. Commands queued for this editor in ClawAI run here only after your approval.',
          ),
        );
      }
    }),
    vscode.commands.registerCommand('clawAI.remoteControl.stop', async () => {
      stop();
      await vscode.window.showInformationMessage(vscode.l10n.t('Remote control is off.'));
    }),
    vscode.commands.registerCommand('clawAI.runner.register', async () => {
      const name = await vscode.window.showInputBox({
        prompt: vscode.l10n.t('Runner name'),
        value: os.hostname().slice(0, 80),
      });
      if (name === undefined || name.trim().length === 0) return;
      const labelText = await vscode.window.showInputBox({
        prompt: vscode.l10n.t('Runner labels, separated by commas (optional)'),
      });
      if (labelText === undefined) return;
      const labels = runnerLabels(labelText);
      const approvalPolicy = await pickApprovalPolicy();
      if (approvalPolicy === undefined) return;
      const runnerId = await begin(
        (host) =>
          agentRemoteClient.registerRunner(deps.backend().remoteRequest, host, {
            name: name.trim(),
            labels,
            approvalPolicy,
          }),
        approvalPolicy,
      );
      if (runnerId !== undefined) {
        await vscode.window.showInformationMessage(
          vscode.l10n.t(
            'This machine is registered as runner {0} and is waiting for jobs.',
            name.trim(),
          ),
        );
      }
    }),
    vscode.commands.registerCommand('clawAI.pairDevice', async () => {
      const outcome = await pairFromPhone(deps);
      await vscode.window.showInformationMessage(pairingMessage(outcome));
    }),
  ];
}

/**
 * A runner talks only to the runner routes with its runner token (F100); a
 * remote-control session keeps the session routes and its session key.
 */
function commandSource(
  backend: () => BackendClient,
  registration: AgentRegistration,
  runner: boolean,
  host: AgentHostIdentity,
): RemoteCommandSource {
  const credential = registration.sessionKey;
  if (runner) {
    return {
      fetch: (signal) => agentRemoteClient.claim(backend().agentKeyRequest, credential, signal),
      heartbeat: () =>
        agentRemoteClient.runnerHeartbeat(backend().agentKeyRequest, credential, {
          agentVersion: host.agentVersion,
          platform: host.platform,
        }),
      complete: (commandId, result) =>
        agentRemoteClient.runnerComplete(backend().agentKeyRequest, credential, commandId, result),
    };
  }
  return {
    fetch: (signal) => agentRemoteClient.pending(backend().agentKeyRequest, credential, signal),
    heartbeat: () => agentRemoteClient.heartbeat(backend().agentKeyRequest, registration),
    complete: (commandId, result) =>
      agentRemoteClient.complete(backend().agentKeyRequest, credential, commandId, result),
  };
}

/** F099: prompt jobs run through the headless SDK under the registered policy. */
function promptRunner(
  deps: RemoteControlDependencies,
  policy: RunnerApprovalPolicy,
): ReturnType<typeof runnerPromptExecutor> {
  return runnerPromptExecutor({
    folders: () =>
      (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
        name: folder.name,
        fsPath: folder.uri.fsPath,
      })),
    accessToken: () => deps.backend().currentAccessToken(),
    backendUrl: deps.backend().authorizationUrl(''),
    policy,
    ask: approveToolLocally,
  });
}

async function pickApprovalPolicy(): Promise<RunnerApprovalPolicy | undefined> {
  const ask = {
    label: vscode.l10n.t('Ask me for every tool call'),
    policy: 'ASK' as const,
  };
  const readOnly = {
    label: vscode.l10n.t('Auto-approve read-only tool calls'),
    detail: vscode.l10n.t('Writes and commands still wait for your approval.'),
    policy: 'AUTO_APPROVE_READ_ONLY' as const,
  };
  const picked = await vscode.window.showQuickPick([ask, readOnly], {
    title: vscode.l10n.t('Runner approval policy for prompt jobs'),
  });
  return picked?.policy;
}

async function approveToolLocally(request: AgentApprovalRequest): Promise<boolean> {
  const allow = vscode.l10n.t('Allow');
  const answer = vscode.window.showWarningMessage(
    vscode.l10n.t(
      'A scheduled prompt job wants to use {0} ({1}). Allow it?',
      request.toolName,
      request.category,
    ),
    { modal: true, detail: JSON.stringify(request.arguments, null, 2).slice(0, 2_000) },
    allow,
  );
  const timeout = new Promise<undefined>((resolve) => {
    setTimeout(resolve, REMOTE_APPROVAL_TIMEOUT_MS);
  });
  return (await Promise.race([answer, timeout])) === allow;
}

async function approveLocally(request: RemoteCommandApproval): Promise<boolean> {
  const run = vscode.l10n.t('Run');
  const answer = vscode.window.showWarningMessage(
    vscode.l10n.t('Run this remote command on this machine?'),
    { modal: true, detail: `${request.command}\n\n${request.workingDir}` },
    run,
  );
  const timeout = new Promise<undefined>((resolve) => {
    setTimeout(resolve, REMOTE_APPROVAL_TIMEOUT_MS);
  });
  return (await Promise.race([answer, timeout])) === run;
}

async function pairFromPhone(deps: RemoteControlDependencies): Promise<DevicePairingOutcome> {
  const controller = new AbortController();
  const request = deps.backend().agentKeyRequest;
  const shown: { panel?: vscode.Disposable } = {};
  try {
    return await runDevicePairing(
      {
        start: () => devicePairingClient.start(request, pairingHint(deps.version)),
        poll: (code, signal) => devicePairingClient.poll(request, code, signal),
        present: (start) => {
          shown.panel = showPairingPanel(start.verificationUrl);
        },
        store: async (tokens) => {
          await deps.secrets.store(PAIRED_DEVICE_SECRET_KEY, JSON.stringify(tokens));
        },
        sleep: abortableSleep,
        now: () => Date.now(),
      },
      controller.signal,
    );
  } finally {
    shown.panel?.dispose();
  }
}

function pairingMessage(outcome: DevicePairingOutcome): string {
  switch (outcome) {
    case 'approved':
      return vscode.l10n.t('This editor is paired.');
    case 'denied':
      return vscode.l10n.t('Pairing was denied.');
    case 'expired':
    case 'cancelled':
      return vscode.l10n.t('Pairing expired. Run the command again.');
    case 'failed':
      return vscode.l10n.t('Pairing failed. Check the ClawAI output and try again.');
  }
}

async function announceFailure(state: RemoteLoopState): Promise<void> {
  if (state === 'failed') {
    await vscode.window.showWarningMessage(
      vscode.l10n.t(
        'Remote commands stopped after repeated failures. Check the ClawAI output and start again.',
      ),
    );
  }
}

function hostIdentity(version: string): AgentHostIdentity {
  return {
    hostname: os.hostname().slice(0, 255),
    platform: process.platform,
    agentVersion: version.slice(0, 50),
  };
}

function pairingHint(version: string): PairingDeviceHint {
  const platform = process.platform;
  const osName = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : 'linux';
  const hostname = os.hostname().slice(0, 253);
  return {
    name: `VS Code on ${hostname}`.slice(0, 128),
    hostname,
    os: osName,
    platform: platform.slice(0, 32),
    agentVersion: version.slice(0, 32),
  };
}

function runnerLabels(text: string): string[] {
  return [
    ...new Set(
      text
        .split(',')
        .map((label) => label.trim().toLowerCase())
        .filter((label) => /^[a-z0-9][a-z0-9._-]{0,39}$/u.test(label)),
    ),
  ].slice(0, 16);
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}
