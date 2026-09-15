import * as vscode from 'vscode';

import { summarizeRun } from '../core/session-recap';

import type { FindingsService } from './findings-service';
import type { RunJournalService } from './run-journal-service';
import type { RecapNextAction, SessionRecap } from '../core/session-recap';

interface RecapDependencies {
  readonly journals: RunJournalService;
  readonly findings: FindingsService;
}

function nextActionLabel(action: RecapNextAction): string {
  if (action === 'replan') {
    return vscode.l10n.t('The workspace moved. Plan again before resuming.');
  }
  if (action === 'approve-then-resume') {
    return vscode.l10n.t('The approval no longer applies. Grant it again, then resume.');
  }
  if (action === 'investigate-failure') {
    return vscode.l10n.t('A tool call failed. Read the failure before repeating it.');
  }
  if (action === 'review-findings') {
    return vscode.l10n.t('Read the findings before building on top of them.');
  }
  if (action === 'resume') return vscode.l10n.t('Nothing is in the way. This run can resume.');
  return vscode.l10n.t('This run is finished.');
}

/**
 * One paragraph a person can read, rather than a record they must interpret.
 *
 * Counts are stated even when zero for the ones a reader checks first — files
 * changed and failures — because "0 files changed" and "the recap did not
 * mention files" are different, and only one of them is an answer.
 */
export function describeRecap(recap: SessionRecap): string {
  const lines = [
    vscode.l10n.t('Goal: {0}', recap.goal),
    vscode.l10n.t(
      '{0} files changed across {1} tool calls.',
      String(recap.filesChanged),
      String(recap.toolCalls),
    ),
  ];
  if (recap.failedInvocations > 0) {
    lines.push(vscode.l10n.t('{0} tool calls failed.', String(recap.failedInvocations)));
  }
  if (recap.unfinishedInvocations > 0) {
    lines.push(
      vscode.l10n.t(
        '{0} tool calls did not finish, and may or may not have taken effect.',
        String(recap.unfinishedInvocations),
      ),
    );
  }
  if (recap.blockingFindings > 0) {
    lines.push(vscode.l10n.t('{0} findings need attention.', String(recap.blockingFindings)));
  }
  if (recap.blockers.length > 0) {
    lines.push(vscode.l10n.t('Blocked by: {0}.', recap.blockers.join(', ')));
  }
  lines.push(nextActionLabel(recap.nextAction));
  return lines.join('\n');
}

/**
 * Summarises a past run the user picks.
 *
 * Returning to a session replayed the raw messages and nothing else, so
 * learning that three files changed and the last tool call failed meant reading
 * the whole transcript and inferring it. Every one of those facts was already
 * recorded in the run journal; none was ever summarised.
 */
export async function showSessionRecap(dependencies: RecapDependencies): Promise<void> {
  const runs = await dependencies.journals.search('');
  if (runs.length === 0) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('There are no recorded ClawAI runs to recap yet.'),
    );
    return;
  }

  const chosen = await vscode.window.showQuickPick(
    [...runs]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((run) => ({ label: run.goal, description: run.lifecycle, runId: run.runId })),
    { placeHolder: vscode.l10n.t('Choose a run to recap') },
  );
  if (chosen === undefined) return;

  const journal = await dependencies.journals.load(chosen.runId);
  if (journal === undefined) {
    await vscode.window.showWarningMessage(
      vscode.l10n.t('That run journal is no longer available.'),
    );
    return;
  }

  // Findings are session-scoped rather than run-scoped, so they are the ones
  // outstanding now — which is what a reader deciding what to do next needs,
  // rather than what was outstanding when the run ended.
  const recap = summarizeRun(journal, undefined, dependencies.findings.current().findings);
  await vscode.window.showInformationMessage(describeRecap(recap), { modal: true });
}
