import type { modelAccessEntrySchema } from './model-access-client.schema';
import type { z } from 'zod';

/** One model's answer: may the signed-in user pick it, and in which cost band. */
export type ModelAccessEntry = z.infer<typeof modelAccessEntrySchema>;

/** A model to ask about. */
export interface ModelAccessQuery {
  readonly provider: string;
  readonly model: string;
}

/** POST seam: the backend client's `request`, narrowed to what this call needs. */
export type ModelAccessRequester = <T>(
  path: string,
  schema: z.ZodType<T>,
  options: { method: 'POST'; body: unknown },
) => Promise<T>;
