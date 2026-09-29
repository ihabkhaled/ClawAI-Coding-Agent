/** SecretStorage key. The webhook URL is itself the credential, so it never lives in settings. */
export const SLACK_WEBHOOK_SECRET_KEY = 'clawAI.integrations.slackWebhookUrl';
export const SLACK_WEBHOOK_HOST = 'hooks.slack.com';
export const SLACK_WEBHOOK_PATH_PREFIX = '/services/';
/** Longest message text sent; a notification is a pointer back, not a transcript. */
export const MAX_SLACK_MESSAGE_LENGTH = 400;
export const SLACK_POST_TIMEOUT_MS = 10_000;
