import { randomUUID } from 'node:crypto';
import path from 'node:path';

import * as vscode from 'vscode';

import type { ExternalOutputGrantStore } from '../core/external-output-grants';

const ADD_OUTPUT = '__add__';

export class ExternalOutputGrantService {
  constructor(private readonly grants: ExternalOutputGrantStore) {}

  async manage(): Promise<void> {
    if (!vscode.workspace.isTrusted) {
      await vscode.window.showWarningMessage(
        vscode.l10n.t('Trust this workspace before granting an external output folder.'),
      );
      return;
    }
    const current = this.grants.snapshot();
    const selected = await vscode.window.showQuickPick(
      [
        {
          label: vscode.l10n.t('Add output folder…'),
          description: vscode.l10n.t('Allow reviewed create and update operations'),
          rootKey: ADD_OUTPUT,
        },
        ...current.map((grant) => ({
          label: grant.label,
          description: vscode.l10n.t('Select to revoke this output permission'),
          rootKey: grant.rootKey,
        })),
      ],
      { title: vscode.l10n.t('External output folders') },
    );
    if (selected === undefined) return;
    if (selected.rootKey === ADD_OUTPUT) {
      await this.add();
      return;
    }
    const revoke = vscode.l10n.t('Revoke');
    const confirmed = await vscode.window.showWarningMessage(
      vscode.l10n.t('Revoke external output permission for {0}?', selected.label),
      { modal: true },
      revoke,
    );
    if (confirmed === revoke) await this.grants.revoke(selected.rootKey);
  }

  private async add(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: vscode.l10n.t('Allow output here'),
      title: vscode.l10n.t('Choose an external output folder'),
    });
    const uri = selected?.[0];
    if (uri?.scheme !== 'file') return;
    await this.grants.grant({
      rootKey: `output-${randomUUID()}`,
      label: path.win32.isAbsolute(uri.fsPath)
        ? path.win32.basename(uri.fsPath)
        : path.basename(uri.fsPath),
      uri: uri.toString(),
    });
    await vscode.window.showInformationMessage(
      vscode.l10n.t(
        'External output folder allowed. Every proposed write there still requires final approval.',
      ),
    );
  }
}
