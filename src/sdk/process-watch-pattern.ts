import { createContext, Script } from 'node:vm';

import { PROCESS_WATCH_MATCH_BUDGET_MS } from './process-watch-tool.constants';

import type { LinePattern } from './process-watch-tool.types';

/**
 * A regular expression that is tested with a time limit.
 *
 * A backtracking pattern such as `(a|aa)+$` can run for hours on one short line,
 * and a regular expression cannot be interrupted from JavaScript, so the test
 * runs in a `vm` context whose `timeout` stops it. A pattern that once overran
 * is never run again (it matches nothing) and `tooSlow` says so; the wait then
 * ends on its own timeout instead of freezing the host.
 */
export class BoundedPattern implements LinePattern {
  private readonly context: { re: RegExp; line: string };
  private readonly script = new Script('re.test(line)');
  private slow = false;

  public constructor(pattern: RegExp) {
    this.context = { re: pattern, line: '' };
    createContext(this.context);
  }

  public get tooSlow(): boolean {
    return this.slow;
  }

  public test(line: string): boolean {
    if (this.slow) return false;
    this.context.line = line;
    try {
      return (
        this.script.runInContext(this.context, {
          timeout: PROCESS_WATCH_MATCH_BUDGET_MS,
        }) === true
      );
    } catch {
      this.slow = true;
      return false;
    }
  }
}
