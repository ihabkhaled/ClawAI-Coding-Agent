import * as vscode from 'vscode';

import { PluginFailure } from '../core/plugin-failure';

import type { PluginFailureCode } from '../core/plugin-manifest.types';

function messageFor(code: PluginFailureCode, detail: string): string {
  switch (code) {
    case 'digest-mismatch':
      return vscode.l10n.t(
        'The plugin content does not match the sha256 the marketplace pinned. Nothing was installed.',
      );
    case 'invalid-catalog':
      return vscode.l10n.t('The marketplace catalog is not valid: {0}', detail);
    case 'invalid-manifest':
      return vscode.l10n.t('The plugin manifest is not valid: {0}', detail);
    case 'invalid-source':
      return vscode.l10n.t('The plugin source is not usable: {0}', detail);
    case 'name-mismatch':
      return vscode.l10n.t('The plugin does not match its marketplace entry: {0}', detail);
    case 'not-allowed':
      return vscode.l10n.t('Workspace policy does not allow this marketplace: {0}', detail);
    case 'too-large':
      return vscode.l10n.t('The plugin is too large.');
    case 'unreachable':
      return vscode.l10n.t('Could not reach {0}.', detail);
    case 'unsafe-path':
      return vscode.l10n.t('The plugin contains an unsafe path: {0}', detail);
  }
}

/** A failure as a sentence the user can act on; anything unexpected keeps its own message. */
export function pluginFailureMessage(error: unknown): string {
  if (error instanceof PluginFailure) return messageFor(error.code, error.detail);
  return error instanceof Error ? error.message : String(error);
}
