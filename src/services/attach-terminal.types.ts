import type { TerminalCapture } from '../core/terminal-reference.types';
import type * as vscode from 'vscode';

/** What attaching terminal output needs to reach. */
export interface AttachTerminalDependencies {
  readonly terminals: () => readonly vscode.Terminal[];
  /** Nothing when shell integration never saw a command in that terminal. */
  readonly capture: (terminal: vscode.Terminal) => TerminalCapture | undefined;
  readonly insert: (block: string) => Promise<void>;
}
