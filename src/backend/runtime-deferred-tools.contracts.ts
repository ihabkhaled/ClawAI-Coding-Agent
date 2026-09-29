import { z } from 'zod';

/** What `POST chat-messages/runtime/runs/:runId/tools` answers (F028). */
export const runtimeDeferredLoadAckSchema = z
  .object({
    runId: z.string().min(1),
    catalogVersion: z.number().int().min(1),
    effectiveCatalogHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    loaded: z
      .array(z.object({ name: z.string().min(1), version: z.string().min(1) }).strict())
      .max(16),
  })
  .strict();

export type RuntimeDeferredLoadAck = z.infer<typeof runtimeDeferredLoadAckSchema>;
