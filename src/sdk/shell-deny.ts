import { createContext, Script } from 'node:vm';

import { SHELL_DENY_BUDGET_MS } from './shell-tool.constants';

const TEST = new Script('re.test(text)');

/**
 * Whether an operator's deny pattern matches `text`, with a time limit.
 *
 * The text is the model's script and the pattern is the operator's, so a pattern
 * such as `(a+)+$` meets input built to make it backtrack, and a regular expression
 * cannot be interrupted from JavaScript. The test runs in a `vm` context with a
 * timeout. A pattern that overruns FAILS CLOSED: the script is refused, because a
 * rule that cannot be evaluated must not read as "allowed".
 */
export function denyOutcome(pattern: RegExp, text: string): 'match' | 'slow' | 'clear' {
  const context = { re: pattern, text };
  createContext(context);
  try {
    return TEST.runInContext(context, { timeout: SHELL_DENY_BUDGET_MS }) === true
      ? 'match'
      : 'clear';
  } catch {
    return 'slow';
  }
}
