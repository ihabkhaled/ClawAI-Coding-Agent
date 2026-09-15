import * as vscode from 'vscode';

import { onboardingChecklist, onboardingComplete } from '../core/onboarding-checklist';

import type { ExtensionState } from '../core/extension-state';

/** The key `contributes.views` consults to decide whether Getting Started belongs on screen. */
export const SETUP_INCOMPLETE_KEY = 'clawAI.setupIncomplete';

/**
 * Shows the setup view only while there is setup left to do.
 *
 * A checklist that stays after it is finished is a permanent reminder of
 * nothing. It comes back on its own if the user signs out or closes the
 * folder, because the checklist is derived from the snapshot rather than a
 * flag that was set once.
 */
export function watchSetupCompletion(state: ExtensionState): vscode.Disposable {
  const publish = (): void => {
    void vscode.commands.executeCommand(
      'setContext',
      SETUP_INCOMPLETE_KEY,
      !onboardingComplete(onboardingChecklist(state.snapshot)),
    );
  };
  publish();
  const unsubscribe = state.subscribe(publish);
  return { dispose: unsubscribe };
}
