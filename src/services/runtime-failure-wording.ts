import * as vscode from 'vscode';

import { limitKind } from '../core/retry-classifier';
import { RATE_LIMIT_STATUS } from '../core/retry-classifier.constants';
import {
  STUCK_FAILURE_CODE,
  STUCK_MESSAGE_PATTERN,
} from '../core/runtime/runtime-repetition.constants';

/**
 * The translated sentence for a failure whose English text the core wrote.
 *
 * A plan or credit 429 says the account is out of allowance, so it is worded as
 * that and never as a busy model; a stuck run names the repeated call. Returns
 * `undefined` for any other failure, which keeps the backend's own message.
 */
export function localizedFailure(code: string, message: string): string | undefined {
  const kind = limitKind(RATE_LIMIT_STATUS, code);
  if (kind === 'credit') {
    return vscode.l10n.t(
      'Your ClawAI credit is used up ({0}). Top up the credit to continue.',
      code,
    );
  }
  if (kind === 'plan') {
    return vscode.l10n.t(
      'Your ClawAI plan limit is reached ({0}). Wait for it to reset or upgrade the plan to continue. Another model does not help.',
      code,
    );
  }
  if (code !== STUCK_FAILURE_CODE) return undefined;
  const match = STUCK_MESSAGE_PATTERN.exec(message);
  if (match === null) return undefined;
  return vscode.l10n.t(
    'The run was stopped: it made the same {0} {1} call {2} times and nothing changed.',
    match[1] ?? '',
    match[2] ?? '',
    match[3] ?? '',
  );
}
