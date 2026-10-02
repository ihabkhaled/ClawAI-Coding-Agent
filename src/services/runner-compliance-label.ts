import * as vscode from 'vscode';

import type { RunnerPolicyView } from '../backend/remote-session-contracts';

/** Plain words for one reason code the backend reports (ADR-142); an unknown code is shown as sent. */
function reasonText(code: string): string {
  switch (code) {
    case 'version_below_minimum':
      return vscode.l10n.t('version is below the organization minimum');
    case 'version_unreadable':
      return vscode.l10n.t('version could not be read');
    case 'version_missing':
      return vscode.l10n.t('no version was reported');
    case 'platform_not_allowed':
      return vscode.l10n.t('platform is not allowed');
    case 'platform_missing':
      return vscode.l10n.t('no platform was reported');
    default:
      return code;
  }
}

/**
 * The runner-policy verdict as one plain sentence for a runner row, or
 * undefined when the backend gave none (policy off, or an older backend).
 */
export function complianceLabel(view: RunnerPolicyView | undefined): string | undefined {
  const verdict = view?.compliance;
  if (verdict === undefined || verdict === null) return undefined;
  const reasons = (verdict.reason ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code.length > 0)
    .map(reasonText)
    .join(', ');
  if (verdict.status === 'compliant') return vscode.l10n.t('Policy: compliant');
  if (verdict.status === 'noncompliant') {
    return reasons.length === 0
      ? vscode.l10n.t('Policy: not compliant')
      : vscode.l10n.t('Policy: not compliant, {0}', reasons);
  }
  return reasons.length === 0
    ? vscode.l10n.t('Policy: could not be checked')
    : vscode.l10n.t('Policy: could not be checked, {0}', reasons);
}
