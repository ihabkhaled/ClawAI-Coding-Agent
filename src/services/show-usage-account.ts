import * as vscode from 'vscode';

import type { AccountUsageSections } from '../backend/usage-breakdown-client.types';
import type { UsageBreakdownTotals } from '../backend/usage-breakdown-contracts';

function cells(totals: UsageBreakdownTotals): string {
  return `${String(totals.requests)} | ${String(totals.inputTokens)} | ${String(
    totals.outputTokens,
  )} | ${String(totals.weightedTokens)} |`;
}

function table(
  heading: string,
  dimension: string,
  rows: readonly { label: string; totals: UsageBreakdownTotals }[],
): string[] {
  return [
    '',
    `### ${heading}`,
    '',
    `| ${dimension} | ${vscode.l10n.t('Requests')} | ${vscode.l10n.t('Input')} | ${vscode.l10n.t(
      'Output',
    )} | ${vscode.l10n.t('Weighted')} |`,
    '| --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.label} | ${cells(row.totals)}`),
  ];
}

function modelRows(
  lines: readonly (UsageBreakdownTotals & { provider: string; model: string })[],
): { label: string; totals: UsageBreakdownTotals }[] {
  return lines.map((line) => ({ label: `${line.provider}/${line.model}`, totals: line }));
}

function summary(totals: UsageBreakdownTotals): string {
  return vscode.l10n.t(
    '{0} weighted tokens over {1} requests.',
    String(totals.weightedTokens),
    String(totals.requests),
  );
}

/**
 * The server-side sections of the usage dialog: this account over the last
 * thirty days, then every organization the user administers.
 *
 * Both come from the ledger, not from this window, so they are labelled apart
 * from the session numbers. A section the backend did not answer is left out
 * rather than shown as zero, which would read as "nothing used".
 */
export function accountUsageLines(sections: AccountUsageSections): string[] {
  const lines: string[] = [];
  if (sections.account !== undefined) {
    const account = sections.account;
    lines.push(
      '',
      `## ${vscode.l10n.t('This account (30 days)')}`,
      '',
      summary(account.totals),
      ...table(
        vscode.l10n.t('By surface'),
        vscode.l10n.t('Surface'),
        account.bySurface.map((line) => ({ label: line.surface, totals: line })),
      ),
      ...table(vscode.l10n.t('By model'), vscode.l10n.t('Model'), modelRows(account.byModel)),
    );
  }
  for (const organization of sections.organizations) {
    const usage = organization.usage;
    lines.push(
      '',
      `## ${vscode.l10n.t('Organization usage: {0}', organization.name)}`,
      '',
      vscode.l10n.t('{0} members.', String(usage.memberCount)),
      summary(usage.totals),
      ...table(
        vscode.l10n.t('By member'),
        vscode.l10n.t('Member'),
        usage.byMember.map((line) => ({ label: line.userId, totals: line })),
      ),
      ...table(vscode.l10n.t('By model'), vscode.l10n.t('Model'), modelRows(usage.byModel)),
    );
  }
  return lines;
}
