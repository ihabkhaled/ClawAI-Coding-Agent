import * as vscode from 'vscode';

import type { PullRequestCheckSummary, WatchedPullRequest } from '../core/pull-request.types';
import type { PullRequestAlertPort } from '../services/pull-request-monitor-service.types';

/**
 * How a watched pull request's result reaches the person: an editor toast.
 *
 * A failure is a warning with one action, because the only decision to make is
 * whether an agent should try; everything else about the failure is on the
 * pull request page. A pass is information and asks nothing.
 */
export class VscodePullRequestAlerts implements PullRequestAlertPort {
  async failed(pr: WatchedPullRequest, summary: PullRequestCheckSummary): Promise<boolean> {
    const fix = vscode.l10n.t('Fix it');
    const names = summary.failing
      .slice(0, 3)
      .map((check) => check.name)
      .join(', ');
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('Checks failed on pull request #{0}: {1}', String(pr.number), names),
      fix,
    );
    return choice === fix;
  }

  passed(pr: WatchedPullRequest): void {
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Checks passed on pull request #{0}.', String(pr.number)),
    );
  }
}
