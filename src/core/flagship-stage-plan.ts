import { z } from 'zod';

import { flagshipStageDefinitionSchema } from './flagship-stage';
import {
  FLAGSHIP_MAX_STAGES,
  FLAGSHIP_MAX_TASK_ACCEPTANCE_CHECKS,
  FLAGSHIP_MIN_STAGES,
  FLAGSHIP_SINGLE_USE_STAGE_KINDS,
  FLAGSHIP_STAGE_FOLLOW_UPS,
  FLAGSHIP_STAGE_KINDS,
  FLAGSHIP_STAGE_PREREQUISITES,
} from './flagship-stage.constants';

import type {
  FlagshipStageDefinition,
  FlagshipStageId,
  ResolvedFlagshipStage,
} from './flagship-stage';

function duplicateIdViolations(stages: readonly FlagshipStageDefinition[]): string[] {
  const seen = new Set<string>();
  const violations: string[] = [];
  for (const { id } of stages) {
    if (seen.has(id)) violations.push(`Stage id "${id}" is declared more than once`);
    seen.add(id);
  }
  return violations;
}

function singleUseViolations(stages: readonly FlagshipStageDefinition[]): string[] {
  return FLAGSHIP_SINGLE_USE_STAGE_KINDS.filter(
    (kind) => stages.filter((stage) => stage.kind === kind).length > 1,
  ).map((kind) => `Stage kind "${kind}" may appear at most once`);
}

function orderViolations(stages: readonly FlagshipStageDefinition[]): string[] {
  const violations: string[] = [];
  stages.forEach((stage, index) => {
    const before = new Set<string>(stages.slice(0, index).map(({ kind }) => kind));
    const after = new Set<string>(stages.slice(index + 1).map(({ kind }) => kind));
    for (const required of FLAGSHIP_STAGE_PREREQUISITES[stage.kind] ?? []) {
      if (!before.has(required))
        violations.push(`Stage "${stage.id}" (${stage.kind}) needs a ${required} stage before it`);
    }
    for (const required of FLAGSHIP_STAGE_FOLLOW_UPS[stage.kind] ?? []) {
      if (!after.has(required))
        violations.push(`Stage "${stage.id}" (${stage.kind}) needs a ${required} stage after it`);
    }
  });
  return violations;
}

/** Every reason a declared stage list would weaken the state machine. */
export function flagshipStagePlanViolations(
  stages: readonly FlagshipStageDefinition[],
): readonly string[] {
  return [
    ...duplicateIdViolations(stages),
    ...singleUseViolations(stages),
    ...orderViolations(stages),
  ];
}

/** A goal's own ordered stage list: bounded, uniquely named, and order-checked. */
export const flagshipStagePlanSchema = z
  .array(flagshipStageDefinitionSchema)
  .min(FLAGSHIP_MIN_STAGES)
  .max(FLAGSHIP_MAX_STAGES)
  .superRefine((stages, context) => {
    for (const message of flagshipStagePlanViolations(stages)) {
      context.addIssue({ code: 'custom', message });
    }
  });

/** The ten-stage order used when a goal declares none. */
export const DEFAULT_FLAGSHIP_STAGE_PLAN: readonly ResolvedFlagshipStage[] =
  FLAGSHIP_STAGE_KINDS.map((kind) => ({ id: kind, kind, acceptanceChecks: [] }));

/** The stages a delivery runs: its own when declared, the default ten otherwise. */
export function resolveFlagshipStagePlan(request: {
  readonly stages?: readonly FlagshipStageDefinition[] | undefined;
}): readonly ResolvedFlagshipStage[] {
  if (request.stages === undefined) return DEFAULT_FLAGSHIP_STAGE_PLAN;
  return request.stages.map((stage) => ({
    id: stage.id,
    kind: stage.kind,
    description: stage.description,
    acceptanceChecks: [...stage.acceptanceChecks],
  }));
}

/** Where a run resumes: the named stage, or the first stage when it is unknown. */
export function flagshipStageIndex(
  plan: readonly ResolvedFlagshipStage[],
  id: FlagshipStageId | undefined,
): number {
  return Math.max(
    0,
    plan.findIndex((stage) => stage.id === id),
  );
}

/**
 * The stage a replan returns to, or -1 when the list has no plan stage. Without
 * one there is nothing to go back to, so a replan request retries the stage.
 */
export function flagshipReplanIndex(plan: readonly ResolvedFlagshipStage[]): number {
  return plan.findIndex((stage) => stage.kind === 'plan');
}

/**
 * The checks a stage's sub-agent must meet: the stage's own first, then the
 * delivery-wide ones, deduplicated and held under the sub-agent ceiling. Empty
 * means the caller supplies its generic evidence check.
 */
export function flagshipStageAcceptanceChecks(
  stage: Pick<ResolvedFlagshipStage, 'acceptanceChecks'> | undefined,
  requestChecks: readonly string[],
): readonly string[] {
  return [...new Set([...(stage?.acceptanceChecks ?? []), ...requestChecks])].slice(
    0,
    FLAGSHIP_MAX_TASK_ACCEPTANCE_CHECKS,
  );
}
