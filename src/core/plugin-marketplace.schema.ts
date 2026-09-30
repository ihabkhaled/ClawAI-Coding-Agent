import { z } from 'zod';

const nameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/u);

/** One plugin a marketplace offers, pinned to the exact bytes it promises. */
export const marketplaceEntrySchema = z
  .object({
    name: nameSchema,
    publisher: nameSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u),
    description: z.string().max(1_000).default(''),
    /** An https `.zip` URL, a path relative to the catalog, or a folder in a local marketplace. */
    source: z.string().min(1).max(2_048),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    /** Base64 detached Ed25519 signature over `canonicalEntryJson`; see `plugin-signature.ts`. */
    signature: z.string().max(200).optional(),
  })
  .strict();

export const marketplaceCatalogSchema = z
  .object({
    name: z.string().min(1).max(200),
    plugins: z.array(marketplaceEntrySchema).max(500),
  })
  .strict();
