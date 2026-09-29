import { describe, expect, it } from 'vitest';

import { flagshipRequestHash, flagshipRequestSchema } from '../../src/core/flagship-delivery';
import {
  DEFAULT_FLAGSHIP_STAGE_PLAN,
  flagshipReplanIndex,
  flagshipStageAcceptanceChecks,
  flagshipStageIndex,
  flagshipStagePlanSchema,
  flagshipStagePlanViolations,
  resolveFlagshipStagePlan,
} from '../../src/core/flagship-stage-plan';
import { flagshipStagesInputSchema } from '../../src/core/runtime/flagship-stage-input-schema';
import { runtimeToolInputSchemas } from '../../src/core/runtime/runtime-tool-input-schemas';
import { flagshipDeliveryRequest } from '../helpers/flagship-stage';

import type { FlagshipStageDefinition } from '../../src/core/flagship-stage';

const check = ['Evidence is attached'];

function stage(id: string, kind: FlagshipStageDefinition['kind']): FlagshipStageDefinition {
  return { id, kind, acceptanceChecks: check };
}

const codingStages: FlagshipStageDefinition[] = [
  stage('survey', 'discover'),
  stage('design', 'plan'),
  stage('guard', 'authorize'),
  stage('build', 'implement'),
  stage('unit-tests', 'verify'),
  stage('browser-check', 'verify'),
  stage('write-up', 'report'),
];

describe('flagship stage plan', () => {
  it('accepts a goal-declared ordered list and repeats model-driven kinds', () => {
    expect(flagshipStagePlanSchema.parse(codingStages)).toHaveLength(7);
    expect(flagshipStagePlanViolations(codingStages)).toEqual([]);
  });

  it('bounds the list to between one and twenty stages', () => {
    expect(flagshipStagePlanSchema.safeParse([]).success).toBe(false);
    const many = Array.from({ length: 21 }, (_, index) =>
      stage(`look-${String(index)}`, 'discover'),
    );
    expect(flagshipStagePlanSchema.safeParse(many).success).toBe(false);
    expect(flagshipStagePlanSchema.safeParse(many.slice(0, 20)).success).toBe(true);
  });

  it('requires acceptance criteria and a slug id on every stage', () => {
    expect(
      flagshipStagePlanSchema.safeParse([{ id: 'survey', kind: 'discover', acceptanceChecks: [] }])
        .success,
    ).toBe(false);
    expect(flagshipStagePlanSchema.safeParse([stage('Bad Id', 'discover')]).success).toBe(false);
    expect(
      flagshipStagePlanSchema.safeParse([{ ...stage('survey', 'discover'), extra: true }]).success,
    ).toBe(false);
  });

  it('refuses duplicate ids and a second use of a single-use kind', () => {
    expect(
      flagshipStagePlanViolations([stage('look', 'discover'), stage('look', 'review')]),
    ).toEqual(['Stage id "look" is declared more than once']);
    expect(flagshipStagePlanViolations([stage('p1', 'plan'), stage('p2', 'plan')])).toEqual([
      'Stage kind "plan" may appear at most once',
    ]);
  });

  it('keeps implement behind plan and authorize, and verify after it', () => {
    expect(flagshipStagePlanViolations([stage('build', 'implement')])).toEqual([
      'Stage "build" (implement) needs a plan stage before it',
      'Stage "build" (implement) needs a authorize stage before it',
      'Stage "build" (implement) needs a verify stage after it',
    ]);
    expect(
      flagshipStagePlanViolations([
        stage('guard', 'authorize'),
        stage('design', 'plan'),
        stage('check', 'verify'),
        stage('build', 'implement'),
      ]),
    ).toEqual(['Stage "build" (implement) needs a verify stage after it']);
  });

  it('never lets the host report an integration or commit that did not happen', () => {
    expect(flagshipStagePlanViolations([stage('merge', 'integrate')])).toEqual([
      'Stage "merge" (integrate) needs a implement stage before it',
    ]);
    expect(flagshipStagePlanViolations([stage('seal', 'commit')])).toEqual([
      'Stage "seal" (commit) needs a integrate stage before it',
    ]);
  });

  it('resolves the default ten when a goal declares none', () => {
    const plan = resolveFlagshipStagePlan({});
    expect(plan).toBe(DEFAULT_FLAGSHIP_STAGE_PLAN);
    expect(plan.map(({ id }) => id)).toEqual(plan.map(({ kind }) => kind));
    expect(plan).toHaveLength(10);
    expect(flagshipReplanIndex(plan)).toBe(1);
  });

  it('resolves a declared list with its own checks and descriptions', () => {
    const plan = resolveFlagshipStagePlan({
      stages: [{ ...stage('survey', 'discover'), description: 'Map the API' }],
    });
    expect(plan).toEqual([
      { id: 'survey', kind: 'discover', description: 'Map the API', acceptanceChecks: check },
    ]);
    expect(flagshipReplanIndex(plan)).toBe(-1);
  });

  it('finds the resume stage by id and falls back to the first', () => {
    const plan = resolveFlagshipStagePlan({ stages: codingStages });
    expect(flagshipStageIndex(plan, 'unit-tests')).toBe(4);
    expect(flagshipStageIndex(plan, 'missing')).toBe(0);
    expect(flagshipStageIndex(plan, undefined)).toBe(0);
  });

  it('merges stage and delivery checks, deduplicated and capped', () => {
    expect(flagshipStageAcceptanceChecks(undefined, [])).toEqual([]);
    expect(flagshipStageAcceptanceChecks({ acceptanceChecks: ['a', 'b'] }, ['b', 'c'])).toEqual([
      'a',
      'b',
      'c',
    ]);
    const wide = Array.from({ length: 300 }, (_, index) => `check ${String(index)}`);
    expect(flagshipStageAcceptanceChecks({ acceptanceChecks: [] }, wide)).toHaveLength(200);
  });

  it('keeps request identity stable without stages and distinct with them', () => {
    const base = flagshipRequestSchema.parse(flagshipDeliveryRequest());
    const withStages = flagshipRequestSchema.parse({
      ...flagshipDeliveryRequest(),
      stages: codingStages,
    });
    expect(base.stages).toBeUndefined();
    expect(flagshipRequestHash(withStages)).not.toBe(flagshipRequestHash(base));
    expect(
      flagshipRequestSchema.safeParse({
        ...flagshipDeliveryRequest(),
        stages: [stage('build', 'implement')],
      }).success,
    ).toBe(false);
  });

  it('describes stages to the model in the flagship tool input schema', () => {
    expect(JSON.stringify(runtimeToolInputSchemas.flagship)).toContain(
      JSON.stringify(flagshipStagesInputSchema),
    );
    expect(flagshipStagesInputSchema).toMatchObject({ minItems: 1, maxItems: 20 });
  });
});
