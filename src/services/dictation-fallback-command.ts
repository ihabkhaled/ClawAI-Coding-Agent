import * as vscode from 'vscode';

import { dictationAdvice } from '../core/voice-dictation';

import type { DictationFailureKind, OsDictationHint } from '../core/voice-dictation.types';

const SPEECH_EXTENSION_ID = 'ms-vscode.vscode-speech';

function reason(failure: DictationFailureKind): string {
  switch (failure) {
    case 'unsupported':
      return vscode.l10n.t('Voice dictation is not available in this editor panel.');
    case 'permission-denied':
      return vscode.l10n.t('The editor did not allow this panel to use the microphone.');
    case 'service-unreachable':
      return vscode.l10n.t('This editor has no speech recognition service the panel can reach.');
    case 'no-microphone':
      return vscode.l10n.t('No microphone could be opened.');
    case 'other':
      return vscode.l10n.t('Voice dictation stopped unexpectedly.');
  }
}

function osTip(hint: OsDictationHint): string {
  switch (hint) {
    case 'windows-win-h':
      return vscode.l10n.t('Click the message box and press Win+H to use Windows dictation.');
    case 'macos-fn-fn':
      return vscode.l10n.t('Click the message box and press Fn twice to use macOS dictation.');
    case 'none':
      return vscode.l10n.t('Use your system dictation while the message box has focus.');
  }
}

/**
 * Tells the user why the composer microphone did not work, and what does.
 *
 * In-panel dictation depends on things a VS Code webview cannot promise, so
 * silence would read as a dead button. The operating system's dictation types
 * into whichever field has focus, so it is the fallback that works everywhere.
 */
export async function reportDictationUnavailable(
  code: string,
  platform: string = process.platform,
): Promise<void> {
  const advice = dictationAdvice(platform, code);
  const speech = vscode.l10n.t('Get VS Code Speech');
  const choice = await vscode.window.showInformationMessage(
    `${reason(advice.failure)} ${osTip(advice.osHint)}`,
    speech,
  );
  if (choice === speech) {
    await vscode.commands.executeCommand(
      'workbench.extensions.search',
      `@id:${SPEECH_EXTENSION_ID}`,
    );
  }
}
