import * as vscode from 'vscode';

import { BUILT_IN_OUTPUT_STYLES } from '../core/output-style';

import type { OutputStyleSelection } from './select-output-style.types';

/** Labels live here rather than in core: the style is a setting, the wording is not. */
const LABELS: Readonly<Record<string, () => string>> = {
  default: () => vscode.l10n.t('Default'),
  concise: () => vscode.l10n.t('Concise'),
  explanatory: () => vscode.l10n.t('Explanatory'),
  learning: () => vscode.l10n.t('Learning'),
};

/**
 * Lets a person choose how answers are written.
 *
 * Workspace styles are offered under the built-ins and marked as coming from
 * the project, because a name alone cannot say whether `concise` is the one
 * that ships here or the one this repository redefined — and the two can mean
 * quite different things.
 */
export async function selectOutputStyle(dependencies: OutputStyleSelection): Promise<void> {
  const workspace = await dependencies.styles.list();
  const workspaceNames = new Set(workspace.map(({ name }) => name));
  const items = [
    ...BUILT_IN_OUTPUT_STYLES.filter(({ name }) => !workspaceNames.has(name)).map(({ name }) => ({
      label: LABELS[name]?.() ?? name,
      style: name,
    })),
    ...workspace.map(({ name }) => ({
      label: LABELS[name]?.() ?? name,
      description: vscode.l10n.t('Defined by this project'),
      style: name,
    })),
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t('How should answers be written?'),
  });
  if (picked === undefined) return;
  await dependencies.configuration.selectOutputStyle(picked.style);
}
