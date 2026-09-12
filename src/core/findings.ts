import { z } from 'zod';

import { isSafeRelativeWorkspacePath, normalizeWorkspacePath } from './workspace-path-policy';

export const FINDING_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;

export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/**
 * One reviewable claim about the code, in the shape a reader can act on.
 *
 * `remediation` is required because a finding without one is an observation,
 * and a review that produces observations wastes the reader's time deciding
 * what to do. `confidence` is required because a reviewer that cannot be wrong
 * reports everything at the same weight, and a list where nothing is uncertain
 * is a list nobody triages.
 */
export const findingSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    severity: z.enum(FINDING_SEVERITIES),
    confidence: z.enum(['high', 'medium', 'low']),
    path: z
      .string()
      .trim()
      .min(1)
      .max(4_096)
      .refine(
        (value) => isSafeRelativeWorkspacePath(normalizeWorkspacePath(value)),
        'A finding must name a workspace-relative path that is not credential-shaped',
      ),
    line: z.number().int().min(1).max(1_000_000).optional(),
    detail: z.string().trim().min(1).max(4_000),
    remediation: z.string().trim().min(1).max(4_000),
    /** Who raised it: a reviewer sub-agent role, a gate id, a scanner name. */
    source: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .transform((finding) => ({ ...finding, path: normalizeWorkspacePath(finding.path) }));

export type Finding = z.output<typeof findingSchema>;

export const findingsSchema = z.array(findingSchema).max(500);

const severityRank = new Map<FindingSeverity, number>(
  FINDING_SEVERITIES.map((severity, index) => [severity, index]),
);

function rank(severity: FindingSeverity): number {
  return severityRank.get(severity) ?? FINDING_SEVERITIES.length;
}

/**
 * Two findings are the same when they say the same thing about the same place.
 *
 * Independent reviewers converge: run three over one diff and the obvious bug
 * arrives three times, once per reviewer. Deduplicating on location and title
 * rather than on the whole record means the same claim collapses even when two
 * reviewers phrased their detail differently, which is the normal case.
 */
function identity(finding: Finding): string {
  return `${finding.path}:${String(finding.line ?? 0)}:${finding.title.toLowerCase()}`;
}

export interface FindingSelection {
  readonly findings: readonly Finding[];
  readonly total: number;
  readonly duplicatesRemoved: number;
  readonly counts: Readonly<Record<FindingSeverity, number>>;
}

/**
 * Merges reviewer output into one triage-ordered list.
 *
 * When duplicates disagree on severity the highest wins, because the cost of
 * over-reporting one finding is a minute of reading and the cost of
 * under-reporting it is the bug shipping. Ordering is severity, then
 * confidence, then location, so the list is read top-down and stays stable
 * across runs — an unstable order makes two review runs impossible to compare.
 */
export function mergeFindings(
  batches: readonly (readonly Finding[])[],
  maxResults = 100,
): FindingSelection {
  const byIdentity = new Map<string, Finding>();
  let duplicatesRemoved = 0;
  for (const finding of batches.flat()) {
    const key = identity(finding);
    const existing = byIdentity.get(key);
    if (existing === undefined) {
      byIdentity.set(key, finding);
      continue;
    }
    duplicatesRemoved += 1;
    if (rank(finding.severity) < rank(existing.severity)) byIdentity.set(key, finding);
  }

  const confidenceRank = { high: 0, medium: 1, low: 2 } as const;
  const merged = [...byIdentity.values()].sort(
    (left, right) =>
      rank(left.severity) - rank(right.severity) ||
      confidenceRank[left.confidence] - confidenceRank[right.confidence] ||
      left.path.localeCompare(right.path) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      left.title.localeCompare(right.title),
  );

  const counts = Object.fromEntries(
    FINDING_SEVERITIES.map((severity) => [
      severity,
      merged.filter((finding) => finding.severity === severity).length,
    ]),
  ) as Record<FindingSeverity, number>;

  return { findings: merged.slice(0, maxResults), total: merged.length, duplicatesRemoved, counts };
}

/**
 * Whether a review should block, given what it found.
 *
 * Confidence gates the decision as well as severity: a low-confidence critical
 * is a question, not a verdict, and blocking on one trains the reader to
 * override the gate, which costs more than the finding was worth.
 */
export function findingsBlockRelease(findings: readonly Finding[]): boolean {
  return findings.some(
    (finding) =>
      (finding.severity === 'critical' || finding.severity === 'high') &&
      finding.confidence !== 'low',
  );
}
