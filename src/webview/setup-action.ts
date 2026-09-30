import * as vscode from 'vscode';

/** What a first-run notice's one button does when it is not a message of its own. */
export async function runSetupAction(action: 'manageTrust' | 'openRetention'): Promise<void> {
  if (action === 'manageTrust') {
    await vscode.commands.executeCommand('workbench.trust.manage');
    return;
  }
  await vscode.commands.executeCommand('workbench.action.openSettings', 'clawAI.zeroDataRetention');
}
