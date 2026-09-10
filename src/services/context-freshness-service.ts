import { compareContextFreshness, contentDigest, staleInclusions } from '../core/context-freshness';

import type {
  ContextFreshnessPort,
  ContextFreshnessResult,
} from './context-freshness-service.types';
import type { ContextInclusion } from '../core/context-collector';

function inclusionKey(inclusion: ContextInclusion): string {
  return inclusion.startLine === undefined
    ? inclusion.path
    : `${inclusion.path}:${String(inclusion.startLine)}-${String(inclusion.endLine)}`;
}

/**
 * Re-reads what a receipt says was collected and reports what has moved on.
 *
 * A file is read once even when several ranges of it were collected, because
 * the expensive part is the read and a receipt of twenty ranges in one file
 * would otherwise open it twenty times.
 *
 * Nothing here decides what to do about a stale range. It reports, and the view
 * shows it: re-collecting behind the user's back would change what the next
 * message sends without saying so.
 */
export async function checkContextFreshness(
  included: readonly ContextInclusion[],
  port: ContextFreshnessPort,
): Promise<ContextFreshnessResult> {
  const current = new Map<string, string | undefined>();
  for (const inclusion of included) {
    const key = inclusionKey(inclusion);
    if (current.has(key)) continue;
    const text = await port.readRange(inclusion.path, inclusion.startLine, inclusion.endLine);
    if (text === undefined) continue;
    current.set(key, contentDigest(text));
  }
  const reports = compareContextFreshness(included, current);
  return { reports, stale: staleInclusions(reports) };
}
