import { z } from 'zod';

/** Who signed each installed plugin, keyed by the plugin's folder. Absent signer means unsigned. */
export const pluginProvenanceSchema = z.record(
  z.string().min(1).max(4_096),
  z.object({ signedBy: z.string().min(1).max(100).optional() }).strict(),
);
