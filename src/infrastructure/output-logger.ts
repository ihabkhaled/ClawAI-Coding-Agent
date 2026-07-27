import { redactText, redactValue } from '../core/redaction';

import type * as vscode from 'vscode';

export class OutputLogger implements vscode.Disposable {
  constructor(private readonly channel: vscode.OutputChannel) {}

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
