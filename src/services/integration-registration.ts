import * as vscode from 'vscode';

import { postReviewComment } from './review-comment-command';
import { manageRoutines } from './routine-commands';
import { SlackNotifier } from './slack-notifier';
import { configureSlackNotifications } from './slack-settings-command';

import type { IntegrationDependencies } from './integration-commands.types';
import type { BackendClient } from '../backend/backend-client';
import type { ExtensionState } from '../core/extension-state';

/**
 * Product integrations: cloud routines, GitHub/GitLab review comments and the
 * Slack run-finished sink. One call from `activate`, so the entry point grows
 * by a line rather than by a feature.
 */
export function registerIntegrations(
  context: vscode.ExtensionContext,
  state: ExtensionState,
  backend: () => BackendClient,
  warn: (message: string) => void,
): void {
  const deps: IntegrationDependencies = {
    request: () => backend().integrationRequest,
    connected: () => state.snapshot.connected,
  };
  const notifier = new SlackNotifier(state, { secrets: context.secrets, warn });
  context.subscriptions.push(
    notifier,
    vscode.commands.registerCommand('clawAI.manageRoutines', () => manageRoutines(deps)),
    vscode.commands.registerCommand('clawAI.postReviewComment', () => postReviewComment(deps)),
    vscode.commands.registerCommand('clawAI.configureSlackNotifications', () =>
      configureSlackNotifications({ secrets: context.secrets, notifier }),
    ),
  );
}
