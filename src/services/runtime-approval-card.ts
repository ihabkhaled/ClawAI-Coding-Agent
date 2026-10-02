import * as vscode from 'vscode';

import { redactText } from '../core/redaction';

import type { ApprovalEffectSummary } from '../core/approval-broker';
import type { PolicyRequest } from '../core/policy-v2';

/** The panel cuts a preview at 4,096 characters; stop a little short so the cut is ours. */
const PREVIEW_CHARACTERS = 4_000;

const BROWSER_TOOL = 'workspace.browser';
const SHELL_TOOL = 'workspace.shell';
const HTTP_TOOL = 'http.request';

/** What the person reads the effect as, one short line. */
function purposeOf(tool: string, operation: string): string {
  if (tool === SHELL_TOOL) return vscode.l10n.t('Run a shell script');
  if (tool === HTTP_TOOL && operation === 'send') {
    return vscode.l10n.t('Send data to a web server');
  }
  if (tool === HTTP_TOOL) return vscode.l10n.t('Read from a web server');
  if (tool === BROWSER_TOOL && operation === 'navigate') {
    return vscode.l10n.t('Open a page in the browser');
  }
  return vscode.l10n.t('Run {0}', `${tool} ${operation}`);
}

/** What it touches: the hosts it reaches, else the paths it names, else the tool itself. */
function targetOf(request: PolicyRequest): string {
  const subject = request.subject;
  if (subject === undefined) return request.scope.targetId;
  if (subject.domains.length > 0) return subject.domains.join(', ');
  if (subject.paths.length > 0) return subject.paths.slice(0, 3).join(', ');
  return `${subject.tool} ${subject.operation}`;
}

/** The exact text to review: the script or command, with anything secret-shaped hidden. */
function previewOf(request: PolicyRequest): string | undefined {
  const command = request.subject?.command;
  if (command === undefined || command.length === 0) return undefined;
  const redacted = redactText(command);
  return redacted.length > PREVIEW_CHARACTERS
    ? `${redacted.slice(0, PREVIEW_CHARACTERS)}\n…`
    : redacted;
}

/**
 * The summary the approval card shows for one tool effect.
 *
 * The card used to say only the effect class ("local-mutation") and the target
 * id ("target:workspace"), so a person approving a shell script or a request to
 * a server could not see which one it was, or what it would run. The subject
 * the policy already holds carries all of it: the tool, the operation, the
 * hosts and the command. Showing it costs nothing and is what makes an
 * approval an informed one.
 */
export function describeRuntimeEffect(request: PolicyRequest): ApprovalEffectSummary {
  const subject = request.subject;
  const preview = previewOf(request);
  return {
    purpose: subject === undefined ? request.effect : purposeOf(subject.tool, subject.operation),
    target: targetOf(request),
    risk: request.risk,
    sideEffects: [request.effect],
    reversibility: request.reversible ? 'reversible' : 'irreversible',
    ...(preview === undefined ? {} : { sanitizedPreview: preview }),
  };
}
