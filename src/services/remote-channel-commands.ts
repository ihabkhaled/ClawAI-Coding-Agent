import { randomUUID } from 'node:crypto';

import * as vscode from 'vscode';

import { connectionOperationErrorMessage } from '../backend/backend-error-message';
import { channelClient } from '../backend/channel-client';
import { remoteJobClient } from '../backend/remote-job-client';
import { CHANNEL_ENABLED_MEMORY_KEY } from '../core/channel-inbox.constants';
import { channelMessageBlock } from '../core/channel-message-format';

import { ChannelInboxWatcher } from './channel-inbox-watcher';

import type { RemoteChannelDependencies } from './remote-channel-commands.types';
import type { BackendClient } from '../backend/backend-client';
import type { ChannelMessage } from '../backend/channel.types';
import type { ExtensionState } from '../core/extension-state';

function surface(dependencies: RemoteChannelDependencies, message: ChannelMessage): void {
  const sendToChat = vscode.l10n.t('Send to Chat');
  const openLink = vscode.l10n.t('Open Link');
  const actions = message.url === null ? [sendToChat] : [sendToChat, openLink];
  void vscode.window
    .showInformationMessage(
      vscode.l10n.t('Channel message from {0}: {1}', message.source, message.title),
      ...actions,
    )
    .then(async (choice) => {
      if (choice === sendToChat) await dependencies.insert(channelMessageBlock(message));
      if (choice === openLink && message.url !== null)
        await vscode.env.openExternal(vscode.Uri.parse(message.url));
    });
}

async function runRemoteJob(dependencies: RemoteChannelDependencies): Promise<void> {
  const jobs = remoteJobClient(dependencies.backend().integrationRequest);
  try {
    const { jobs: listed } = await jobs.list();
    if (listed.length === 0) {
      await vscode.window.showInformationMessage(
        vscode.l10n.t('No remote jobs yet. Pair a device, then ask the agent to create one.'),
      );
      return;
    }
    const picked = await vscode.window.showQuickPick(
      listed.map((job) => ({ label: job.name, description: job.command, id: job.id })),
      { placeHolder: vscode.l10n.t('Select a remote job to run now') },
    );
    if (picked === undefined) return;
    // A fresh key per user request: a network retry of this request cannot run the job twice.
    const fired = await jobs.trigger(picked.id, randomUUID());
    await vscode.window.showInformationMessage(
      vscode.l10n.t(
        'Remote job "{0}" started as command {1} ({2}).',
        picked.label,
        fired.command.id,
        fired.command.status,
      ),
    );
  } catch (error) {
    await vscode.window.showErrorMessage(
      vscode.l10n.t('Remote job could not start: {0}', connectionOperationErrorMessage(error)),
    );
  }
}

async function showWebhook(
  dependencies: RemoteChannelDependencies,
  watcher: ChannelInboxWatcher,
): Promise<void> {
  try {
    const webhook = await channelClient(dependencies.backend().integrationRequest).webhook();
    await dependencies.enable();
    watcher.start();
    const copyUrl = vscode.l10n.t('Copy URL');
    const copySecret = vscode.l10n.t('Copy Secret');
    const choice = await vscode.window.showInformationMessage(
      vscode.l10n.t(
        'Channel webhook ready. POST signed JSON to {0}; the secret signs each request.',
        webhook.url,
      ),
      copyUrl,
      copySecret,
    );
    if (choice === copyUrl) await vscode.env.clipboard.writeText(webhook.url);
    // The secret goes to the clipboard only, never into a notification or a log.
    if (choice === copySecret) await vscode.env.clipboard.writeText(webhook.secret);
  } catch (error) {
    await vscode.window.showErrorMessage(
      vscode.l10n.t('Channel inbox could not be read: {0}', connectionOperationErrorMessage(error)),
    );
  }
}

async function checkInbox(watcher: ChannelInboxWatcher): Promise<void> {
  try {
    const count = await watcher.checkNow();
    watcher.start();
    if (count === 0)
      await vscode.window.showInformationMessage(vscode.l10n.t('No new channel messages.'));
  } catch (error) {
    await vscode.window.showErrorMessage(
      vscode.l10n.t('Channel inbox could not be read: {0}', connectionOperationErrorMessage(error)),
    );
  }
}

/**
 * RemoteTrigger (F029) and Channels (F083) commands, plus the bounded inbox
 * watch. The watch starts on its own only once the user has asked for their
 * webhook, so an installation that never uses channels never polls.
 */
export function registerRemoteChannelCommands(
  backend: () => BackendClient,
  state: Pick<ExtensionState, 'snapshot'>,
  view: { appendToComposer(block: string): Promise<void> },
  context: Pick<vscode.ExtensionContext, 'globalState'>,
): vscode.Disposable[] {
  const dependencies: RemoteChannelDependencies = {
    backend,
    signedIn: () => state.snapshot.connected,
    insert: (block) => view.appendToComposer(block),
    enabled: () => context.globalState.get<boolean>(CHANNEL_ENABLED_MEMORY_KEY) === true,
    enable: () => Promise.resolve(context.globalState.update(CHANNEL_ENABLED_MEMORY_KEY, true)),
  };
  const watcher = new ChannelInboxWatcher({
    inbox: () => channelClient(backend().integrationRequest),
    signedIn: dependencies.signedIn,
    surface: (message) => {
      surface(dependencies, message);
    },
    schedule: (callback, delayMs) => {
      const handle = setTimeout(callback, delayMs);
      return {
        cancel: () => {
          clearTimeout(handle);
        },
      };
    },
  });
  if (dependencies.enabled()) watcher.start();
  return [
    {
      dispose: () => {
        watcher.dispose();
      },
    },
    vscode.commands.registerCommand('clawAI.runRemoteJob', () => runRemoteJob(dependencies)),
    vscode.commands.registerCommand('clawAI.showChannelWebhook', () =>
      showWebhook(dependencies, watcher),
    ),
    vscode.commands.registerCommand('clawAI.checkChannelInbox', () => checkInbox(watcher)),
  ];
}
