import { randomBytes } from 'node:crypto';

import * as vscode from 'vscode';

import { pairingPanelHtml } from '../core/pairing-panel-html';

const PAIRING_PANEL_TYPE = 'clawAI.pairing';

/**
 * Shows the approval link as a QR code to scan with a phone, plus a Copy Link
 * button. Returns a handle that closes the panel once pairing has ended.
 */
export function showPairingPanel(url: string): vscode.Disposable {
  const panel = vscode.window.createWebviewPanel(
    PAIRING_PANEL_TYPE,
    vscode.l10n.t('Pair This Editor From Your Phone'),
    vscode.ViewColumn.Active,
    { enableScripts: true, localResourceRoots: [] },
  );
  panel.webview.html = pairingPanelHtml({
    url,
    nonce: randomBytes(16).toString('base64'),
    labels: {
      title: vscode.l10n.t('Pair This Editor From Your Phone'),
      instruction: vscode.l10n.t(
        'Scan this code with your phone camera, signed in to ClawAI, then approve this editor.',
      ),
      qrLabel: vscode.l10n.t('QR code with the pairing link'),
      linkHeading: vscode.l10n.t('Or open this link'),
      copyLink: vscode.l10n.t('Copy Link'),
      noQr: vscode.l10n.t('This link is too long for a QR code. Copy it instead.'),
    },
  });
  panel.webview.onDidReceiveMessage((message: unknown) => {
    if (isCopyMessage(message)) {
      void vscode.env.clipboard.writeText(url);
      void vscode.window.showInformationMessage(vscode.l10n.t('Link copied.'));
    }
  });
  return panel;
}

function isCopyMessage(message: unknown): boolean {
  return (
    typeof message === 'object' && message !== null && 'type' in message && message.type === 'copy'
  );
}
