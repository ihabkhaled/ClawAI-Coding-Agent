import { redactText } from './redaction';
import {
  MAX_SLACK_MESSAGE_LENGTH,
  SLACK_WEBHOOK_HOST,
  SLACK_WEBHOOK_PATH_PREFIX,
} from './slack-notification.constants';

/**
 * True only for a Slack incoming-webhook URL.
 *
 * Anything else is refused rather than posted to: the sink sends run outcomes,
 * and an arbitrary URL here would turn a notification into an exfiltration
 * channel to whatever host was pasted.
 */
export function isSlackWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      url.protocol === 'https:' &&
      url.hostname.toLowerCase() === SLACK_WEBHOOK_HOST &&
      url.pathname.startsWith(SLACK_WEBHOOK_PATH_PREFIX) &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

/**
 * The JSON body posted to the webhook.
 *
 * Redacted and cut short: the text names the outcome and at most a short,
 * redacted reason. The prompt, the answer and file contents are never sent.
 */
export function slackMessageBody(text: string): { readonly text: string } {
  const redacted = redactText(text).replace(/\s+/g, ' ').trim();
  return {
    text:
      redacted.length > MAX_SLACK_MESSAGE_LENGTH
        ? `${redacted.slice(0, MAX_SLACK_MESSAGE_LENGTH - 1)}…`
        : redacted,
  };
}
