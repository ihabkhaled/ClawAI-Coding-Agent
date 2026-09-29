import { z } from 'zod';

import {
  buildReviewGraph,
  changedPathsFromDiff,
  selectReviewDimensions,
  verifyReviewFindings,
} from '../core/code-review';
import { findingsBlockRelease } from '../core/findings';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { ReviewToolPorts } from './review-tool-executor.types';
import type { ReviewDimension } from '../core/code-review.types';
import type { SubAgentOutcome } from '../core/multi-agent-dag';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

const reviewSchema = z
  .object({
    rootKey: z.string().trim().min(3).max(100),
    baseBranch: z.string().trim().min(1).max(200).optional(),
    dimensions: z.array(z.string().min(1).max(40)).min(2).max(4).optional(),
  })
  .strip();

export const reviewToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'runtime.review',
  version: '2.0.0',
  description:
    'Review the current change with two to four independent reviewer sub-agents, one per ' +
    'dimension: correctness, security, tests, performance (all four when dimensions is ' +
    'omitted). run takes rootKey and optional baseBranch — the diff is measured against it, or ' +
    'against HEAD for uncommitted work. Findings about files the diff does not touch are ' +
    'rejected, duplicates merged, findings two reviewers agree on promoted, and the result is ' +
    'ranked worst first and shown in the Findings view.',
  operations: ['run'],
  riskClasses: ['inspect', 'process'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.review,
};

function withSource(outcome: SubAgentOutcome) {
  const dimension = outcome.taskId.replace(/^review-/u, '');
  return outcome.findings.map((finding) => ({ ...finding, source: finding.source ?? dimension }));
}

/**
 * Multi-agent code review: fan out, verify, merge, rank.
 *
 * The fan-out runs through the ordinary sub-agent coordinator, so reviewers get
 * the same budgets, epochs and tool scoping as any other sub-agent, and their
 * findings reach the Findings view through the observer that already files
 * them. What this adds is the step after: a finding outside the diff is taken
 * back out of the view, so what a person reads is what the review can defend.
 */
export class ReviewToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly ports: ReviewToolPorts) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== reviewToolDefinition.name || invocation.operation !== 'run') {
      throw new Error('Unknown review operation');
    }
    const request = reviewSchema.parse(invocation.arguments);
    const dimensions = selectReviewDimensions(request.dimensions);
    const baseRef = request.baseBranch ?? 'HEAD';
    const receipt = await this.ports.git.execute(
      { rootKey: request.rootKey, operation: 'diff', ref: baseRef },
      signal,
    );
    const changedPaths = changedPathsFromDiff(receipt.output);
    if (changedPaths.length === 0) {
      return { structured: { reviewed: false, reason: 'empty-diff', baseRef } };
    }
    const outcomes = await this.ports.agents.run(
      buildReviewGraph({
        rootKey: request.rootKey,
        runId: invocation.runId,
        epochs: invocation.epochs,
        dimensions,
        diff: receipt.output,
        changedPaths,
        baseRef,
      }),
      signal,
    );
    return { structured: this.report(outcomes, changedPaths, dimensions, baseRef) };
  }

  private report(
    outcomes: readonly SubAgentOutcome[],
    changedPaths: readonly string[],
    dimensions: readonly ReviewDimension[],
    baseRef: string,
  ): Record<string, unknown> {
    const verification = verifyReviewFindings(outcomes.flatMap(withSource), changedPaths);
    this.ports.findings.discard(verification.rejected);
    const { selection } = verification;
    return {
      reviewed: true,
      baseRef,
      dimensions,
      changedPaths: changedPaths.length,
      findings: selection.findings,
      total: selection.total,
      counts: selection.counts,
      duplicatesRemoved: selection.duplicatesRemoved,
      rejectedOutOfScope: verification.rejected.length,
      corroborated: verification.corroborated,
      blocking: findingsBlockRelease(selection.findings),
      reviewers: outcomes.map((outcome) => ({
        taskId: outcome.taskId,
        status: outcome.status,
        findings: outcome.findings.length,
        ...(outcome.blocker === undefined ? {} : { blocker: outcome.blocker }),
      })),
    };
  }
}
