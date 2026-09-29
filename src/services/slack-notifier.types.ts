/** The slice of `vscode.SecretStorage` the Slack sink uses. */
export interface SlackSecretPort {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export interface SlackNotifierOptions {
  readonly secrets: SlackSecretPort;
  readonly fetcher?: typeof fetch;
  readonly windowFocused?: () => boolean;
  /** Receives a message that never contains the webhook URL. */
  readonly warn?: (message: string) => void;
}

export type SlackPostOutcome = 'sent' | 'not-configured' | 'failed';
