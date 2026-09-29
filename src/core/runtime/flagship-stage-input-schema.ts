import {
  FLAGSHIP_MAX_STAGE_ACCEPTANCE_CHECKS,
  FLAGSHIP_MAX_STAGES,
  FLAGSHIP_MIN_STAGES,
  FLAGSHIP_STAGE_ID_MAX_LENGTH,
  FLAGSHIP_STAGE_ID_MIN_LENGTH,
  FLAGSHIP_STAGE_KINDS,
} from '../flagship-stage.constants';

import type { RuntimeJsonObject } from './runtime-tool-contracts';

const stageDefinition: RuntimeJsonObject = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      minLength: FLAGSHIP_STAGE_ID_MIN_LENGTH,
      maxLength: FLAGSHIP_STAGE_ID_MAX_LENGTH,
      description: 'Lowercase slug naming this stage, unique within the list.',
    },
    kind: {
      type: 'string',
      enum: [...FLAGSHIP_STAGE_KINDS],
      description:
        'The behaviour this stage runs. plan, authorize, implement, integrate and commit may appear once each; implement needs plan and authorize before it and verify after it, integrate needs implement before it, commit needs integrate before it.',
    },
    description: { type: 'string', minLength: 1, maxLength: 2_000 },
    acceptanceChecks: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 2_000 },
      minItems: 1,
      maxItems: FLAGSHIP_MAX_STAGE_ACCEPTANCE_CHECKS,
    },
  },
  required: ['id', 'kind', 'acceptanceChecks'],
  additionalProperties: false,
  maxProperties: 64,
};

/**
 * Mirrors flagshipStagePlanSchema for the model. Ordering rules are stated in
 * the kind description because this catalog carries no cross-item keywords; the
 * validator is what enforces them.
 */
export const flagshipStagesInputSchema: RuntimeJsonObject = {
  type: 'array',
  items: stageDefinition,
  minItems: FLAGSHIP_MIN_STAGES,
  maxItems: FLAGSHIP_MAX_STAGES,
  description: 'Optional ordered stage list for this goal. Omit to run the default ten stages.',
};
