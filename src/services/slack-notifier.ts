import * as vscode from 'vscode';

import { slackMessageBody } from '../core/slack-notification';
import {
  SLACK_POST_TIMEOUT_MS,
  SLACK_WEBHOOK_SECRET_KEY,
} from '../core/slack-notification.constants';
import { notificationReasonForStateChange } from '../core/user-notification';

import type { SlackNotifierOptions, SlackPostOutcome } from './slack-notifier.types';
import type { ExtensionSnapshot, ExtensionState } from '../core/extension-state';
import type { NotifiableState } from '../core/user-notification';

function notifiable(snapshot: ExtensionSnapshot): NotifiableState {
  return {
    approvalRequestId: snapshot.approvalRequest?.id,
    questionRequestId: snapshot.questionRequest?.id,
    busy: snapshot.busy,
    lastError: snapshot.lastError,
  };
}

/**
 * Posts "your run finished" to a Slack incoming webhook.
 *
 * It rides the same decision as the desktop notification, so it fires only
 * while the window is unfocused: Slack exists for the person who walked away.
 * Only completions and failures are sent, and a failure carries its redacted
 * reason and nothing else — no prompt, answer, path list or file content.
 *
 * The webhook URL is the credential. It lives in SecretStorage, is read per
 * post, and never reaches a log line or an error message.
 */
export class SlackNotifier implements vscode.Disposable {
  private previous: NotifiableState;
  private readonly unsubscribe: () => void;
  private readonly fetcher: typeof fetch;
  private readonly windowFocused: () => boolean;
  private readonly warn: (message: string) => void;

  constructor(
    state: ExtensionState,
    private readonly options: SlackNotifierOptions,
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.windowFocused = options.windowFocused ?? (() => vscode.window.state.focused);
    this.warn = options.warn ?? (() => undefined);
    this.previous = notifiable(state.snapshot);
    this.unsubscribe = state.subscribe((snapshot) => {
      this.observe(snapshot);
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  /** Sends one message now. Used by the observer and by "Send test message". */
  async post(text: string): Promise<SlackPostOutcome> {
    const url = await this.options.secrets.get(SLACK_WEBHOOK_SECRET_KEY);
    if (url === undefined || url.length === 0) return 'not-configured';
    try {
      const response = await this.fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackMessageBody(text)),
        signal: AbortSignal.timeout(SLACK_POST_TIMEOUT_MS),
      });
      if (response.ok) return 'sent';
      this.warn(`Slack notification rejected (HTTP ${String(response.status)}).`);
      return 'failed';
    } catch (error: unknown) {
      this.warn(`Slack notification failed: ${error instanceof Error ? error.name : 'unknown'}.`);
      return 'failed';
    }
  }

  private observe(snapshot: ExtensionSnapshot): void {
    const next = notifiable(snapshot);
    const reason = notificationReasonForStateChange(this.previous, next, this.windowFocused());
    this.previous = next;
    if (reason === 'completion') {
      void this.post(vscode.l10n.t('ClawAI finished the request.'));
    } else if (reason === 'failure') {
      void this.post(vscode.l10n.t('The ClawAI request failed: {0}', snapshot.lastError ?? ''));
    }
  }
}
