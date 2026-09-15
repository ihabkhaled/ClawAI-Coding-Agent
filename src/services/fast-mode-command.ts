import * as vscode from 'vscode';

import { disableFastMode, enableFastMode, isFastMode } from '../core/fast-mode';

import type { FastModeDependencies } from './fast-mode-command.types';

/**
 * Turns Fast mode on, or puts back what was there before.
 *
 * The remembered pair is cleared on the way out rather than left behind. A
 * stale memory is worse than none: turning Fast mode on next week and off again
 * would restore a routing mode chosen for a task nobody remembers.
 *
 * The message names both levers, because a control that silently changes two
 * settings is one people distrust the first time they open the settings file.
 */
export async function toggleFastMode(dependencies: FastModeDependencies): Promise<boolean> {
  if (isFastMode(dependencies.current())) {
    await dependencies.apply(disableFastMode(dependencies.remembered()));
    await dependencies.remember(undefined);
    await vscode.window.showInformationMessage(vscode.l10n.t('Fast mode is off.'));
    return false;
  }
  const { apply, remember } = enableFastMode(dependencies.current());
  await dependencies.remember(remember);
  await dependencies.apply(apply);
  await vscode.window.showInformationMessage(
    vscode.l10n.t('Fast mode is on: the router prefers a quick model and context is gathered 2X.'),
  );
  return true;
}
