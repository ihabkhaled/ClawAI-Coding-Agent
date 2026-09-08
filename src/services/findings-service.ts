import { mergeFindings } from '../core/findings';

import type { Finding, FindingSelection } from '../core/findings';

interface FindingsStatePort {
  update(patch: { findings: readonly Finding[] }): void;
}

/**
 * Holds the findings reported during this session, merged and triage-ordered.
 *
 * Findings accumulate across calls on purpose: a review is usually several
 * reviewers reporting separately, and each should add to one list rather than
 * replace it. Merging on every write means the caller cannot see a duplicated
 * or mis-ordered list even briefly.
 *
 * Publishing into the extension state is what stops this becoming another
 * subsystem that records into a void — the parity audit found five of those,
 * and a findings store nobody reads would be the sixth.
 */
export class FindingsService {
  private findings: readonly Finding[] = [];

  constructor(private readonly state: FindingsStatePort) {}

  record(reported: readonly Finding[]): FindingSelection {
    const selection = mergeFindings([this.findings, reported]);
    this.findings = selection.findings;
    this.state.update({ findings: this.findings });
    return selection;
  }

  current(): FindingSelection {
    return mergeFindings([this.findings]);
  }

  /**
   * Cleared on an account or workspace boundary, like every other run-scoped
   * value: a finding names a path in a workspace that is no longer open.
   */
  clear(): void {
    this.findings = [];
    this.state.update({ findings: this.findings });
  }
}
