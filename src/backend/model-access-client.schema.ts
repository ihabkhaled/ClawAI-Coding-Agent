import { z } from 'zod';

import { MODEL_COST_CLASSES } from './model-access-client.constants';

/**
 * `costClass` and `coveredByAllowance` are optional on purpose: an older or
 * degraded backend leaves them out, and a band this client does not know reads
 * as absent rather than failing the whole answer.
 */
export const modelAccessEntrySchema = z
  .object({
    provider: z.string(),
    model: z.string(),
    allowed: z.boolean(),
    costClass: z.enum(MODEL_COST_CLASSES).optional().catch(undefined),
    coveredByAllowance: z.boolean().optional().catch(undefined),
  })
  .loose();

export const modelAccessListSchema = z.array(modelAccessEntrySchema);
