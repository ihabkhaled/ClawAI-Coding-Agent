import { z } from 'zod';

const count = z.number().int().nonnegative();

const totalsShape = {
  requests: count,
  weightedTokens: count,
  inputTokens: count,
  outputTokens: count,
};

const modelLineSchema = z.object({ provider: z.string(), model: z.string(), ...totalsShape });

/** `GET /auth/me/usage/breakdown` — the caller's own usage, by surface and model (F107). */
export const accountUsageBreakdownSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    totals: z.object(totalsShape),
    bySurface: z.array(z.object({ surface: z.string(), ...totalsShape })),
    byModel: z.array(modelLineSchema),
  })
  .loose();

/** `GET /auth/me/organizations/:id/usage` — an administered organization's usage (F108). */
export const organizationUsageSchema = z
  .object({
    organizationId: z.string(),
    from: z.string(),
    to: z.string(),
    memberCount: count,
    totals: z.object(totalsShape),
    byMember: z.array(z.object({ userId: z.string(), ...totalsShape })),
    byModel: z.array(modelLineSchema),
  })
  .loose();

/** The organizations the signed-in user belongs to, as `GET /agent/organizations` lists them. */
export const memberOrganizationsSchema = z.array(
  z.object({ id: z.string(), name: z.string() }).loose(),
);

export type AccountUsageBreakdown = z.infer<typeof accountUsageBreakdownSchema>;
export type OrganizationUsage = z.infer<typeof organizationUsageSchema>;
export type UsageBreakdownTotals = AccountUsageBreakdown['totals'];
