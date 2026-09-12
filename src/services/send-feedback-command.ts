import * as vscode from 'vscode';

import extensionPackage from '../../package.json';
import { buildDiagnosticReport } from '../core/diagnostic-report';
import { VscodeSandboxProbe } from '../infrastructure/vscode-sandbox-probe';

import type { BackendClient } from '../backend/backend-client';
import type { FeedbackType } from '../backend/contracts';
import type { ExtensionState } from '../core/extension-state';

interface FeedbackDependencies {
  readonly backend: () => BackendClient;
  readonly state: ExtensionState;
}

/**
 * Probed once for the session. The answer cannot change while the process
 * runs, and a bug report about a command that reached something it should not
 * is unanswerable without it.
 */
const sandboxProbe = new VscodeSandboxProbe();

const feedbackTypeLabels: Readonly<Record<'BUG_REPORT' | 'FEATURE_REQUEST' | 'OTHER', string>> = {
  BUG_REPORT: 'Bug report',
  FEATURE_REQUEST: 'Feature request',
  OTHER: 'Something else',
};

function reportFor(dependencies: FeedbackDependencies): string {
  const snapshot = dependencies.state.snapshot;
  return buildDiagnosticReport({
    extensionVersion: extensionPackage.version,
    vscodeVersion: vscode.version,
    platform: process.platform,
    sandbox: sandboxProbe.guarantees(),
    locale: vscode.env.language,
    backendOrigin: snapshot.backendUrl,
    backendStatus: snapshot.backendStatus,
    connected: snapshot.connected,
    routingMode: snapshot.routingMode,
    selectedModel: snapshot.selectedModel,
    permissionMode: snapshot.permissionMode,
    agentMode: snapshot.agentMode,
    workspaceOpen: snapshot.workspaceScope.selectedFolderKey !== undefined,
    workspaceTrusted: snapshot.workspaceReadiness?.trusted ?? false,
    lastError: snapshot.lastError,
    recentRunIds: Object.keys(snapshot.runtime.runs).slice(0, 10),
  });
}

/**
 * Builds a diagnostic report, shows it, and submits it only if the user says so.
 *
 * The order is the feature. A support form that gathers state and sends it on
 * one click is a disclosure channel the user has to trust; this one opens the
 * exact text in an editor first, so the thing they approve is the thing that
 * is sent, and closing the editor is a complete answer.
 *
 * The report describes the installation only — versions, connection state,
 * modes, run ids. No prompt, transcript, path or file content is collected,
 * and the last error goes through the same redaction every logged string does.
 */
export async function sendFeedback(dependencies: FeedbackDependencies): Promise<void> {
  const typeChoice = await vscode.window.showQuickPick(
    [
      { label: vscode.l10n.t('Bug report'), value: 'BUG_REPORT' as const },
      { label: vscode.l10n.t('Feature request'), value: 'FEATURE_REQUEST' as const },
      { label: vscode.l10n.t('Something else'), value: 'OTHER' as const },
    ],
    { title: vscode.l10n.t('What kind of feedback is this?') },
  );
  if (typeChoice === undefined) return;

  const title = await vscode.window.showInputBox({
    title: vscode.l10n.t('Describe it in one line'),
    prompt: vscode.l10n.t('This becomes the ticket title.'),
    validateInput: (value) =>
      value.trim().length === 0 ? vscode.l10n.t('A title is required.') : undefined,
  });
  if (title === undefined || title.trim().length === 0) return;

  const body = [
    `# ${title.trim()}`,
    '',
    `_${feedbackTypeLabels[typeChoice.value]}_`,
    '',
    vscode.l10n.t('Add anything else worth knowing above this line, then send.'),
    '',
    '---',
    '',
    reportFor(dependencies),
  ].join('\n');

  const document = await vscode.workspace.openTextDocument({
    content: body,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(document, { preview: false });

  const send = vscode.l10n.t('Send to ClawAI');
  const choice = await vscode.window.showInformationMessage(
    vscode.l10n.t('Review the report, then send it. Nothing is sent until you choose Send.'),
    { modal: true },
    send,
  );
  if (choice !== send) return;

  try {
    const ticket = await dependencies.backend().submitFeedback({
      type: typeChoice.value satisfies FeedbackType,
      title: title.trim(),
      // What was reviewed is what is sent, edits included.
      contentMarkdown: document.getText(),
    });
    await vscode.window.showInformationMessage(
      vscode.l10n.t('Feedback sent. Ticket {0}.', ticket.ticketNumber),
    );
  } catch (error: unknown) {
    // Never reported as sent. A support report the user believes arrived and
    // did not is worse than one that plainly failed.
    await vscode.window.showErrorMessage(
      vscode.l10n.t(
        'Feedback could not be sent: {0}',
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}
