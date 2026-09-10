import * as vscode from 'vscode';

import { MAX_TERMINAL_OUTPUT_BYTES } from '../core/terminal-reference';

import type { TerminalCapture } from '../core/terminal-reference.types';

/**
 * Remembers the last command each terminal ran, and what it printed.
 *
 * VS Code exposes terminal output only as a stream while a command runs —
 * there is no API for reading the buffer afterwards, and there should not be.
 * So output has to be captured as it happens, which means only commands that
 * started after the extension activated can ever be referenced. That is a
 * platform limit, and the command that uses this says so rather than
 * attaching an empty block.
 *
 * Only the most recent command per terminal is kept. A scrollback of every
 * command in every terminal is a memory leak wearing a feature's clothes, and
 * the one people mean is nearly always the last one.
 */
export class VscodeTerminalTracker implements vscode.Disposable {
  private readonly captures = new Map<vscode.Terminal, TerminalCapture>();
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor() {
    this.subscriptions.push(
      vscode.window.onDidStartTerminalShellExecution((event) => {
        void this.record(event.terminal, event.execution);
      }),
      vscode.window.onDidCloseTerminal((terminal) => {
        this.captures.delete(terminal);
      }),
    );
  }

  capture(terminal: vscode.Terminal): TerminalCapture | undefined {
    return this.captures.get(terminal);
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.captures.clear();
  }

  private async record(
    terminal: vscode.Terminal,
    execution: vscode.TerminalShellExecution,
  ): Promise<void> {
    let output = '';
    try {
      for await (const chunk of execution.read()) {
        output += chunk;
        // Trimmed as it arrives, not at the end: a command that prints a
        // gigabyte should cost a bounded amount of memory, not a bounded
        // amount of attention after the fact.
        if (output.length > MAX_TERMINAL_OUTPUT_BYTES * 2) {
          output = output.slice(-MAX_TERMINAL_OUTPUT_BYTES);
        }
      }
    } catch {
      // A stream that ends badly still leaves whatever arrived worth keeping.
    }
    this.captures.set(terminal, {
      terminalName: terminal.name,
      output,
      ...(execution.commandLine.value.length === 0 ? {} : { command: execution.commandLine.value }),
    });
  }
}
