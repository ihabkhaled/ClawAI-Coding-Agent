import type { SlackNotifier } from './slack-notifier';
import type { SlackSecretPort } from './slack-notifier.types';
import type { IntegrationRequester } from '../backend/integration-contracts';

/** What the routine, review-comment and Slack commands need from the extension. */
export interface IntegrationDependencies {
  /** Read per call: reconnecting replaces the backend client. */
  readonly request: () => IntegrationRequester;
  readonly connected: () => boolean;
}

export interface SlackSettingsDependencies {
  readonly secrets: SlackSecretPort;
  readonly notifier: SlackNotifier;
}
