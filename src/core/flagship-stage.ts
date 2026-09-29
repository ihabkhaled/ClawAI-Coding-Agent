import { z } from 'zod';

import {
  FLAGSHIP_MAX_STAGE_ACCEPTANCE_CHECKS,
  FLAGSHIP_STAGE_ID_MAX_LENGTH,
  FLAGSHIP_STAGE_ID_MIN_LENGTH,
  FLAGSHIP_STAGE_ID_PATTERN,
  FLAGSHIP_STAGE_KINDS,
} from './flagship-stage.constants';

/** The behaviour a stage runs. See FLAGSHIP_STAGE_KINDS. */
export const flagshipStageSchema = z.enum(FLAGSHIP_STAGE_KINDS);
export type FlagshipStage = z.infer<typeof flagshipStageSchema>;

/**
 * The name a stage goes by in the snapshot, the attempts ledger, and the stage
 * summaries. In the default list it equals the kind; a goal-declared list names
 * its own. A slug, because it becomes part of a sub-agent task id.
 */
export const flagshipStageIdSchema = z
  .string()
  .min(FLAGSHIP_STAGE_ID_MIN_LENGTH)
  .max(FLAGSHIP_STAGE_ID_MAX_LENGTH)
  .regex(FLAGSHIP_STAGE_ID_PATTERN);
export type FlagshipStageId = z.infer<typeof flagshipStageIdSchema>;

/** One stage a goal declares: its name, its behaviour, and when it is done. */
export const flagshipStageDefinitionSchema = z
  .object({
    id: flagshipStageIdSchema,
    kind: flagshipStageSchema,
    description: z.string().min(1).max(2_000).optional(),
    acceptanceChecks: z
      .array(z.string().min(1).max(2_000))
      .min(1)
      .max(FLAGSHIP_MAX_STAGE_ACCEPTANCE_CHECKS),
  })
  .strict();
export type FlagshipStageDefinition = z.infer<typeof flagshipStageDefinitionSchema>;

/**
 * A stage as the delivery service runs it. The default ten carry no
 * stage-specific checks, so their acceptance falls back to the request-wide
 * checks exactly as before custom stage lists existed.
 */
export interface ResolvedFlagshipStage {
  readonly id: FlagshipStageId;
  readonly kind: FlagshipStage;
  readonly description?: string | undefined;
  readonly acceptanceChecks: readonly string[];
}
