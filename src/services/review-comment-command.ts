import * as vscode from 'vscode';

import { reviewActionClient } from '../backend/review-action-client';
import { parseReviewTarget, planReviewComment } from '../core/review-target';

import type { IntegrationDependencies } from './integration-commands.types';
import type { ReviewConnector, WorkspaceAction } from '../backend/integration-contracts';
import type { ReviewTarget, ReviewTargetRefusal } from '../core/review-target.types';

function targetRefusal(refusal: ReviewTargetRefusal): string {
  if (refusal === 'not-https') return vscode.l10n.t('Only https:// review links are accepted.');
  return vscode.l10n.t('Paste a GitHub pull request or GitLab merge request link.');
}

function targetLabel(target: ReviewTarget): string {
  return target.provider === 'GITHUB'
    ? `${target.owner}/${target.repo}#${String(target.pullNumber)}`
    : `${target.projectPath}!${String(target.iid)}`;
}

async function pickConnector(
  connectors: readonly ReviewConnector[],
): Promise<ReviewConnector | undefined> {
  if (connectors.length <= 1) return connectors[0];
  const picked = await vscode.window.showQuickPick(
    connectors.map((connector) => ({ label: connector.name, connector })),
    { title: vscode.l10n.t('Post with which connector?') },
  );
  return picked?.connector;
}

function selectedText(): string {
  const editor = vscode.window.activeTextEditor;
  return editor === undefined ? '' : editor.document.getText(editor.selection);
}

async function report(action: WorkspaceAction): Promise<void> {
  const url = action.result?.url;
  if (action.status !== 'EXECUTED' || url === undefined) {
    const reason = action.errorMessage ?? action.result?.errorMessage ?? action.status;
    await vscode.window.showErrorMessage(vscode.l10n.t('The comment was not posted: {0}', reason));
    return;
  }
  const open = vscode.l10n.t('Open');
  const choice = await vscode.window.showInformationMessage(
    vscode.l10n.t('Review comment posted.'),
    open,
  );
  if (choice === open) await vscode.env.openExternal(vscode.Uri.parse(url));
}

async function post(deps: IntegrationDependencies): Promise<void> {
  const link = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('GitHub pull request or GitLab merge request link'),
  });
  if (link === undefined) return;
  const parsed = parseReviewTarget(link);
  if (!parsed.ok) {
    await vscode.window.showErrorMessage(targetRefusal(parsed.refusal));
    return;
  }
  const connectors = await reviewActionClient.writableConnectors(
    deps.request(),
    parsed.target.provider,
  );
  const connector = await pickConnector(connectors);
  if (connector === undefined) {
    await vscode.window.showErrorMessage(
      vscode.l10n.t(
        'No {0} connector with write access. Connect one in ClawAI Workspace.',
        parsed.target.provider,
      ),
    );
    return;
  }
  const body = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('Review comment'),
    value: selectedText(),
  });
  if (body === undefined) return;
  const plan = planReviewComment(parsed.target, body);
  if (!plan.ok) {
    await vscode.window.showErrorMessage(
      vscode.l10n.t('The comment must be 1 to 10000 characters.'),
    );
    return;
  }
  const confirm = vscode.l10n.t('Post comment');
  const answer = await vscode.window.showWarningMessage(
    vscode.l10n.t('Post this comment on {0} as {1}?', targetLabel(parsed.target), connector.name),
    { modal: true, detail: String(plan.draft.payload.body) },
    confirm,
  );
  if (answer !== confirm) return;
  const drafted = await reviewActionClient.draft(deps.request(), connector.id, plan.draft);
  await report(await reviewActionClient.approve(deps.request(), drafted.id));
}

/** `clawAI.postReviewComment`: one comment on a GitHub PR or GitLab MR, approved in the editor. */
export async function postReviewComment(deps: IntegrationDependencies): Promise<void> {
  if (!deps.connected()) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('Connect to ClawAI to post review comments.'),
    );
    return;
  }
  try {
    await post(deps);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(vscode.l10n.t('The comment was not posted: {0}', reason));
  }
}
