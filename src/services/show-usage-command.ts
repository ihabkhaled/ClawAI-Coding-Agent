import * as vscode from 'vscode';

import { buildUsageReport } from '../core/usage-report';

import type { ExtensionState } from '../core/extension-state';
import type { UsageFeatureLine, UsageWindowLine } from '../core/usage-report';

interface UsageDependencies {
  readonly state: ExtensionState;
}

function windowRow(line: UsageWindowLine): string {
  const limit =
    line.limit === null
      ? vscode.l10n.t('unlimited')
      : `${String(line.used)} / ${String(line.limit)}`;
  const percent = line.percentUsed === null ? '' : ` (${line.percentUsed.toFixed(0)}%)`;
  return `| ${line.window} | ${line.limit === null ? String(line.used) : limit}${percent} | ${
    line.remaining === null ? vscode.l10n.t('unlimited') : String(line.remaining)
  } |`;
}

function featureRow(line: UsageFeatureLine): string {
  return `| ${line.feature} | ${String(line.used)} | ${
    line.limit === null ? vscode.l10n.t('unlimited') : String(line.limit)
  } | ${line.allowed ? vscode.l10n.t('yes') : vscode.l10n.t('no')} |`;
}

/**
 * Shows what this account has used, from data the client already had.
 *
 * The day, week and month windows and every feature limit arrive with the
 * account refresh and were rendered as a single status-bar tooltip line. That
 * is enough to notice a number and not enough to act on one.
 *
 * Rendered from the last refresh rather than fetched on open: this is the same
 * usage every other surface in the extension is reading, and a dialog that
 * quietly disagreed with the status bar would be worse than one that is a
 * refresh behind.
 */
export async function showUsage(dependencies: UsageDependencies): Promise<void> {
  const usage = dependencies.state.snapshot.usage;
  if (usage === undefined) {
    await vscode.window.showInformationMessage(vscode.l10n.t('Connect to ClawAI to see usage.'));
    return;
  }
  const report = buildUsageReport(usage);
  const lines = [
    `# ${vscode.l10n.t('ClawAI usage')}`,
    '',
    `| ${vscode.l10n.t('Window')} | ${vscode.l10n.t('Used')} | ${vscode.l10n.t('Remaining')} |`,
    '| --- | --- | --- |',
    ...report.windows.map(windowRow),
  ];
  if (report.features.length > 0) {
    lines.push(
      '',
      `## ${vscode.l10n.t('Features')}`,
      '',
      `| ${vscode.l10n.t('Feature')} | ${vscode.l10n.t('Used')} | ${vscode.l10n.t(
        'Limit',
      )} | ${vscode.l10n.t('Allowed')} |`,
      '| --- | --- | --- | --- |',
      ...report.features.map(featureRow),
    );
  }
  const document = await vscode.workspace.openTextDocument({
    content: lines.join('\n'),
    language: 'markdown',
  });
  await vscode.window.showTextDocument(document, { preview: false });
}
