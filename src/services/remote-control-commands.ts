import os from 'node:os';

import * as vscode from 'vscode';

import {
  agentRemoteClient,
  type AgentHostIdentity,
  type AgentRegistration,
} from '../backend/agent-remote-client';
import { devicePairingClient, type PairingDeviceHint } from '../backend/device-pairing-client';
import { runBoundedCommand } from '../infrastructure/bounded-command-runner';

import { runDevicePairing } from './device-pairing-flow';
import { RemoteCommandLoop } from './remote-command-loop';
import {
  PAIRED_DEVICE_SECRET_KEY,
  REMOTE_APPROVAL_TIMEOUT_MS,
} from './remote-control-commands.constants';

import type { DevicePairingOutcome } from './device-pairing-flow.types';
import type {
  RemoteCommandApproval,
  RemoteCommandSource,
  RemoteLoopState,
} from './remote-command-loop.types';
import type { BackendClient } from '../backend/backend-client';
import type { OutputLogger } from '../infrastructure/output-logger';

interface RemoteControlDependencies {
  readonly backend: () => BackendClient;
  readonly secrets: vscode.SecretStorage;
  readonly logger: OutputLogger;
  readonly version: string;
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
  const begin = async (
    register: (host: AgentHostIdentity) => Promise<AgentRegistration>,
    runner: boolean,
  ): Promise<string | undefined> => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!vscode.workspace.isTrusted || root === undefined) {
      await vscode.window.showWarningMessage(
        vscode.l10n.t('Open a trusted workspace folder before accepting remote commands.'),
      );
      return undefined;
    }
    stop();
    const registration = await register(hostIdentity(deps.version));
    const current = new RemoteCommandLoop({
      source: commandSource(deps.backend, registration, runner),
      approve: approveLocally,
      execute: async (executable, args, cwd, signal) => {
        const result = await runBoundedCommand(executable, [...args], cwd, signal);
        return {
          exitCode: result.exitCode,
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
        };
      },
      workspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
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
        false,
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
      const runnerId = await begin(
        (host) =>
          agentRemoteClient.registerRunner(deps.backend().remoteRequest, host, {
            name: name.trim(),
            labels,
          }),
        true,
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

function commandSource(
  backend: () => BackendClient,
  registration: AgentRegistration,
  runner: boolean,
): RemoteCommandSource {
  return {
    fetch: (signal) =>
      runner
        ? agentRemoteClient.claim(backend().agentKeyRequest, registration.sessionKey, signal)
        : agentRemoteClient.pending(backend().agentKeyRequest, registration.sessionKey, signal),
    heartbeat: () => agentRemoteClient.heartbeat(backend().agentKeyRequest, registration),
    complete: (commandId, result) =>
      agentRemoteClient.complete(
        backend().agentKeyRequest,
        registration.sessionKey,
        commandId,
        result,
      ),
  };
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
  return runDevicePairing(
    {
      start: () => devicePairingClient.start(request, pairingHint(deps.version)),
      poll: (code, signal) => devicePairingClient.poll(request, code, signal),
      present: (start) => {
        void presentPairingLink(start.verificationUrl);
      },
      store: async (tokens) => {
        await deps.secrets.store(PAIRED_DEVICE_SECRET_KEY, JSON.stringify(tokens));
      },
      sleep: abortableSleep,
      now: () => Date.now(),
    },
    controller.signal,
  );
}

async function presentPairingLink(url: string): Promise<void> {
  const copy = vscode.l10n.t('Copy Link');
  const choice = await vscode.window.showInformationMessage(
    vscode.l10n.t(
      'Open this link on your phone, signed in to ClawAI, and approve this editor: {0}',
      url,
    ),
    copy,
  );
  if (choice === copy) {
    await vscode.env.clipboard.writeText(url);
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
