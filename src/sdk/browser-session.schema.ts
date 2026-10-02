import { z } from 'zod';

/** What the page reports about itself when a snapshot is taken. */
export const browserPageFactsSchema = z.object({
  focus: z.string(),
  viewport: z.string(),
  overflow: z.boolean(),
  secrets: z.array(z.string()).default([]),
});
