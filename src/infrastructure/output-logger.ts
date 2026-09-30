import { redactText, redactValue } from '../core/redaction';

import type * as vscode from 'vscode';

export class OutputLogger implements vscode.Disposable {
  /**
   * `debugEnabled` follows the host's own log level (Developer: Set Log Level),
   * so timing marks cost nothing and appear nowhere unless someone asks.
   */
  constructor(
    private readonly channel: vscode.OutputChannel,
    private readonly debugEnabled: () => boolean = () => false,
  ) {}

  debug(message: string, details?: unknown): void {
    if (this.debugEnabled()) this.append('DEBUG', message, details);
  }

  info(message: string, details?: unknown): void {
    this.append('INFO', message, details);
  }

  warn(message: string, details?: unknown): void {
    this.append('WARN', message, details);
  }

  error(message: string, error?: unknown): void {
    this.append('ERROR', message, error);
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }

  private append(level: string, message: string, details?: unknown): void {
    const timestamp = new Date().toISOString();
    const suffix = details === undefined ? '' : ` ${JSON.stringify(redactValue(details))}`;
    this.channel.appendLine(`${timestamp} ${level} ${redactText(message)}${suffix}`);
  }
}
