import * as vscode from 'vscode';

import { isSlackWebhookUrl } from '../core/slack-notification';
import { SLACK_WEBHOOK_SECRET_KEY } from '../core/slack-notification.constants';

import type { SlackSettingsDependencies } from './integration-commands.types';

async function setWebhook(deps: SlackSettingsDependencies): Promise<void> {
  const url = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('Slack incoming webhook URL (stored in the OS keychain)'),
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) =>
      isSlackWebhookUrl(value)
        ? undefined
        : vscode.l10n.t('Must be an https://hooks.slack.com/services/… URL.'),
  });
  if (url === undefined) return;
  await deps.secrets.store(SLACK_WEBHOOK_SECRET_KEY, url.trim());
  await vscode.window.showInformationMessage(
    vscode.l10n.t(
      'Slack notifications on. Finished and failed runs are posted while VS Code is in the background.',
    ),
  );
}

async function sendTest(deps: SlackSettingsDependencies): Promise<void> {
  const outcome = await deps.notifier.post(vscode.l10n.t('ClawAI test notification.'));
  if (outcome === 'sent') {
    await vscode.window.showInformationMessage(vscode.l10n.t('Test message sent to Slack.'));
  } else if (outcome === 'not-configured') {
    await vscode.window.showInformationMessage(vscode.l10n.t('No Slack webhook is set.'));
  } else {
    await vscode.window.showErrorMessage(vscode.l10n.t('Slack did not accept the test message.'));
  }
}

/** `clawAI.configureSlackNotifications`: set, test or remove the webhook. */
export async function configureSlackNotifications(deps: SlackSettingsDependencies): Promise<void> {
  const set = vscode.l10n.t('Set webhook URL');
  const test = vscode.l10n.t('Send test message');
  const remove = vscode.l10n.t('Remove webhook');
  const choice = await vscode.window.showQuickPick([set, test, remove], {
    title: vscode.l10n.t('Slack notifications'),
  });
  if (choice === set) await setWebhook(deps);
  else if (choice === test) await sendTest(deps);
  else if (choice === remove) {
    await deps.secrets.delete(SLACK_WEBHOOK_SECRET_KEY);
    await vscode.window.showInformationMessage(vscode.l10n.t('Slack notifications off.'));
  }
}
