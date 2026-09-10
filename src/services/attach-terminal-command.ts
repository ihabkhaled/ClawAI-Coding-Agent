import * as vscode from 'vscode';

import { terminalReferenceBlock } from '../core/terminal-reference';

import type { AttachTerminalDependencies } from './attach-terminal.types';

/**
 * Puts the output of a terminal the user is already looking at into the chat.
 *
 * VS Code only exposes terminal output through shell integration, and only for
 * commands it saw start. A terminal without it can be named but not read —
 * that is a platform limit, and saying so is better than attaching an empty
 * block and letting the model wonder.
 */
export async function attachTerminalOutput(
  dependencies: AttachTerminalDependencies,
): Promise<void> {
  const terminals = dependencies.terminals();
  if (terminals.length === 0) {
    await vscode.window.showInformationMessage(vscode.l10n.t('There are no open terminals.'));
    return;
  }
  const picked = await vscode.window.showQuickPick(
    terminals.map((terminal) => ({ label: terminal.name, terminal })),
    { title: vscode.l10n.t('Which terminal?') },
  );
  if (picked === undefined) return;
  const capture = dependencies.capture(picked.terminal);
  if (capture === undefined) {
    await vscode.window.showWarningMessage(
      vscode.l10n.t(
        'That terminal has no readable output. Shell integration must be active for ClawAI to read it.',
      ),
    );
    return;
  }
  await dependencies.insert(terminalReferenceBlock(capture));
}
