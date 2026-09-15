import { createHash } from 'node:crypto';

import type { ContextInclusion } from './context-collector';
import type { ContextFreshnessReport } from './context-freshness.types';

/**
 * How much of the hash is kept.
 *
 * This digest never guards anything: it answers "is this the same text", and
 * the failure it must avoid is a false MATCH, which sixteen hex characters
 * makes vanishingly unlikely for the number of files one conversation touches.
 * A full digest in every receipt row would be sixty-four characters of noise in
 * a structure a person reads.
 */
const DIGEST_LENGTH = 16;

export function contentDigest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, DIGEST_LENGTH);
}

function inclusionKey(inclusion: ContextInclusion): string {
  return inclusion.startLine === undefined
    ? inclusion.path
    : `${inclusion.path}:${String(inclusion.startLine)}-${String(inclusion.endLine)}`;
}

/**
 * Which of the collected files no longer say what they said.
 *
 * A `path:L-L` reference is a snapshot of a range, not a live view of it. Edit
 * the file afterwards and the same line numbers point somewhere else, so the
 * transcript claims the model read something it never saw. That is the quiet
 * kind of wrong: nothing errors, and the conversation reads as though it were
 * still about the current code.
 *
 * `gone` and `changed` are kept apart because they need different answers. A
 * changed range can be re-collected by sending again; a file that no longer
 * exists cannot, and telling someone to refresh a deleted file wastes their
 * time.
 *
 * An inclusion collected before digests existed reports `fresh` rather than
 * `changed`. Claiming a file changed on the strength of a missing record would
 * make every old receipt look wrong at once.
 */
export function compareContextFreshness(
  included: readonly ContextInclusion[],
  current: ReadonlyMap<string, string | undefined>,
): ContextFreshnessReport[] {
  const reports: ContextFreshnessReport[] = [];
  for (const inclusion of included) {
    const range = {
      path: inclusion.path,
      ...(inclusion.startLine === undefined
        ? {}
        : { startLine: inclusion.startLine, endLine: inclusion.endLine }),
    };
    if (inclusion.digest === undefined) {
      reports.push({ ...range, state: 'fresh' });
      continue;
    }
    if (!current.has(inclusionKey(inclusion))) {
      reports.push({ ...range, state: 'gone' });
      continue;
    }
    const now = current.get(inclusionKey(inclusion));
    reports.push({ ...range, state: now === inclusion.digest ? 'fresh' : 'changed' });
  }
  return reports;
}

/** The rows worth telling someone about: the ones that are no longer true. */
export function staleInclusions(
  reports: readonly ContextFreshnessReport[],
): ContextFreshnessReport[] {
  return reports.filter((report) => report.state !== 'fresh');
}
