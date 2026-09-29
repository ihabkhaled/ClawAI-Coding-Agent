import {
  MAX_REVIEW_DIFF_CHARS,
  REVIEW_DIMENSION_BRIEFS,
  REVIEW_DIMENSIONS,
  REVIEWER_BUDGET,
  REVIEWER_TOOLS,
} from './code-review.constants';
import { findingIdentity, mergeFindings } from './findings';
import { normalizeWorkspacePath } from './workspace-path-policy';

import type { ReviewDimension, ReviewGraphInput, ReviewVerification } from './code-review.types';
import type { Finding } from './findings';
import type { SubAgentGraph, SubAgentTask } from './multi-agent-dag';

/**
 * The files a unified diff changes, by their new name.
 *
 * Read from the `diff --git a/… b/…` headers rather than from `+++` lines,
 * because a deleted file's `+++` is `/dev/null` and a rename's header is the
 * only line that names both sides.
 */
export function changedPathsFromDiff(diff: string): string[] {
  const paths = new Set<string>();
  for (const match of diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gmu)) {
    const path = match[2]?.trim();
    if (path !== undefined && path.length > 0) paths.add(normalizeWorkspacePath(path));
  }
  return [...paths].sort();
}

/** The requested dimensions, deduplicated, in the canonical order; all four when none were named. */
export function selectReviewDimensions(
  requested: readonly string[] | undefined,
): ReviewDimension[] {
  const wanted = new Set(requested ?? REVIEW_DIMENSIONS);
  const selected = REVIEW_DIMENSIONS.filter((dimension) => wanted.has(dimension));
  if (selected.length === 0) throw new Error('A review needs at least one known dimension');
  return selected;
}

function reviewerGoal(dimension: ReviewDimension, input: ReviewGraphInput): string {
  const diff =
    input.diff.length <= MAX_REVIEW_DIFF_CHARS
      ? input.diff
      : `${input.diff.slice(0, MAX_REVIEW_DIFF_CHARS)}\n… (truncated — read the rest with workspace.git diff)`;
  return [
    `Review this change for ${dimension} only.`,
    REVIEW_DIMENSION_BRIEFS[dimension].focus,
    `The change is the diff against ${input.baseRef} in root ${input.rootKey}. Changed files:\n${input.changedPaths.map((path) => `- ${path}`).join('\n')}`,
    'Before reporting a finding, open the file and re-read the exact lines it cites. Report through workspace.quality report, with a remediation, an honest confidence, and source set to your dimension. Report nothing rather than a guess.',
    `Diff:\n\`\`\`diff\n${diff}\n\`\`\``,
  ].join('\n\n');
}

function reviewerTask(dimension: ReviewDimension, input: ReviewGraphInput): SubAgentTask {
  return {
    taskId: `review-${dimension}`,
    role: REVIEW_DIMENSION_BRIEFS[dimension].role,
    goal: reviewerGoal(dimension, input),
    modelPolicy: {
      allowedProviders: [],
      allowedModels: [],
      localPreferred: false,
      minimumContextTokens: 0,
    },
    contextNodeIds: [],
    dependencies: [],
    // Read-only: an empty write set is what keeps a reviewer in the main root
    // rather than a worktree of its own, and out of every file lease.
    writeSet: [],
    integrationSeams: [],
    worktreeId: input.rootKey,
    budget: { ...REVIEWER_BUDGET },
    tools: [...REVIEWER_TOOLS],
    // The tests reviewer may run the project's tests to prove a gap; the others
    // only read.
    riskCeiling: dimension === 'tests' ? 'R2' : 'R0',
    inherit: 'none',
    acceptanceChecks: [
      'Every finding names a file changed in this diff and a line re-read before reporting.',
      'Every finding has a remediation and a confidence that reflects how sure you are.',
      `Nothing outside ${dimension} is reported.`,
    ],
    epochs: input.epochs,
  };
}

/**
 * One independent reviewer per dimension, all running at once over one diff.
 *
 * No task depends on another on purpose. A reviewer that has read another's
 * findings anchors on them, and the point of several reviewers is that they
 * disagree where the code is ambiguous. Agreement is measured afterwards, in
 * `verifyReviewFindings`, where it means something.
 */
export function buildReviewGraph(input: ReviewGraphInput): SubAgentGraph {
  if (input.dimensions.length === 0) throw new Error('A review needs at least one dimension');
  return {
    graphId: `review-${input.runId}`,
    parentRunId: input.runId,
    tasks: input.dimensions.map((dimension) => reviewerTask(dimension, input)),
    maxConcurrency: input.dimensions.length,
  };
}

function corroborate(findings: readonly Finding[]): { findings: Finding[]; corroborated: number } {
  const sources = new Map<string, Set<string>>();
  for (const finding of findings) {
    const key = findingIdentity(finding);
    const seen = sources.get(key) ?? new Set<string>();
    seen.add(finding.source ?? 'unknown');
    sources.set(key, seen);
  }
  const agreed = new Set(
    [...sources.entries()].filter(([, seen]) => seen.size > 1).map(([key]) => key),
  );
  return {
    corroborated: agreed.size,
    findings: findings.map((finding) =>
      agreed.has(findingIdentity(finding)) && finding.confidence === 'low'
        ? { ...finding, confidence: 'medium' as const }
        : finding,
    ),
  };
}

/**
 * Keeps what the review can stand behind, merged and ranked.
 *
 * A finding about a file this diff does not touch is rejected: it may be true,
 * but it is not a finding about this change, and a review that wanders into the
 * rest of the codebase stops being a review of anything. A low-confidence
 * finding two reviewers raised independently is promoted, because independent
 * agreement is evidence the single reviewer did not have.
 */
export function verifyReviewFindings(
  findings: readonly Finding[],
  changedPaths: readonly string[],
): ReviewVerification {
  const inScope = new Set(changedPaths.map((path) => normalizeWorkspacePath(path)));
  const rejected = findings.filter((finding) => !inScope.has(finding.path));
  const kept = findings.filter((finding) => inScope.has(finding.path));
  const { findings: agreed, corroborated } = corroborate(kept);
  return { selection: mergeFindings([agreed]), rejected, corroborated };
}
