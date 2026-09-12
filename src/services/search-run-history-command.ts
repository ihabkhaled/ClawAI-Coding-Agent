import * as vscode from 'vscode';

import type { RunJournalService } from './run-journal-service';
import type { RunJournalSearch, RunJournalSummary } from '../core/run-journal-search';

interface SearchDependencies {
  readonly journals: RunJournalService;
}

const lifecycleFacets: readonly {
  readonly label: string;
  readonly value: RunJournalSearch['lifecycle'];
}[] = [
  { label: 'Any outcome', value: undefined },
  { label: 'Completed', value: 'completed' },
  { label: 'Abandoned', value: 'abandoned' },
  { label: 'Cancelled', value: 'cancelled' },
  { label: 'Resumable', value: 'resumable' },
  { label: 'Blocked by drift', value: 'blocked-by-drift' },
];

function describe(summary: RunJournalSummary): string {
  return [summary.lifecycle, summary.updatedAt.slice(0, 10), ...summary.labels].join(' · ');
}

/**
 * Puts run history in front of a person.
 *
 * Searching journals existed, but only as a tool the model could call, so the
 * one party who knows which run they are looking for could not look. This is
 * that bridge: a query, an outcome facet, and results that open the redacted
 * export rather than the encrypted record.
 *
 * The export is what opens, not the journal itself — the same redaction the
 * agent-facing `safe-export` applies, for the same reason. A history browser
 * that showed more than the export would be a way around it.
 */
export async function searchRunHistory(dependencies: SearchDependencies): Promise<void> {
  const query = await vscode.window.showInputBox({
    title: vscode.l10n.t('Search run history'),
    prompt: vscode.l10n.t('Match the goal or a label. Leave empty to list everything.'),
  });
  if (query === undefined) return;

  const lifecycle = await vscode.window.showQuickPick(
    lifecycleFacets.map((facet) => ({ label: vscode.l10n.t(facet.label), value: facet.value })),
    { title: vscode.l10n.t('Narrow by outcome') },
  );
  if (lifecycle === undefined) return;

  const matches = await dependencies.journals.search({
    query,
    ...(lifecycle.value === undefined ? {} : { lifecycle: lifecycle.value }),
  });
  if (matches.length === 0) {
    await vscode.window.showInformationMessage(vscode.l10n.t('No runs matched.'));
    return;
  }

  const chosen = await vscode.window.showQuickPick(
    matches.map((summary) => ({
      label: summary.pinned ? `$(pinned) ${summary.goal}` : summary.goal,
      description: describe(summary),
      runId: summary.runId,
    })),
    { title: vscode.l10n.t('{0} runs matched', matches.length) },
  );
  if (chosen === undefined) return;

  const document = await vscode.workspace.openTextDocument({
    content: JSON.stringify(await dependencies.journals.safeExport(chosen.runId), null, 2),
    language: 'json',
  });
  await vscode.window.showTextDocument(document, { preview: false });
}
