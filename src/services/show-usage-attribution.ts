import * as vscode from 'vscode';

import type {
  UsageAttributionLine,
  UsageAttributionSummary,
} from '../core/usage-attribution.types';

function row(line: UsageAttributionLine): string {
  return `| ${line.dimension} | ${String(line.turns)} | ${String(line.input)} | ${String(
    line.output,
  )} | ${String(line.cached)} | ${String(line.total)} |`;
}

function table(
  heading: string,
  dimension: string,
  lines: readonly UsageAttributionLine[],
): string[] {
  return [
    '',
    `### ${heading}`,
    '',
    `| ${dimension} | ${vscode.l10n.t('Turns')} | ${vscode.l10n.t('Input')} | ${vscode.l10n.t(
      'Output',
    )} | ${vscode.l10n.t('Cached')} | ${vscode.l10n.t('Total')} |`,
    '| --- | --- | --- | --- | --- | --- |',
    ...lines.map(row),
  ];
}

/**
 * The attribution section of the usage dialog: what this window's session
 * spent, by what spent it and on which model.
 *
 * Session-scoped and labelled as such, because the account windows above it
 * come from the server and these numbers do not. A sub-agent reports only a
 * total, so its input and output columns read zero rather than a guess.
 */
export function usageAttributionLines(summary: UsageAttributionSummary): string[] {
  const lines = ['', `## ${vscode.l10n.t('This session')}`, ''];
  if (summary.turns === 0) {
    return [...lines, vscode.l10n.t('Nothing has used tokens in this session yet.')];
  }
  return [
    ...lines,
    vscode.l10n.t('{0} tokens over {1} turns.', String(summary.total), String(summary.turns)),
    ...table(vscode.l10n.t('By source'), vscode.l10n.t('Source'), summary.bySource),
    ...table(vscode.l10n.t('By model'), vscode.l10n.t('Model'), summary.byModel),
  ];
}
