import type { AccountUsageBreakdown, OrganizationUsage } from './usage-breakdown-contracts';
import type { z } from 'zod';

/** One administered organization's usage, with the name the dialog shows. */
export interface NamedOrganizationUsage {
  readonly name: string;
  readonly usage: OrganizationUsage;
}

/** The server-side usage sections; each is absent when the backend did not answer it. */
export interface AccountUsageSections {
  readonly account?: AccountUsageBreakdown;
  readonly organizations: readonly NamedOrganizationUsage[];
}

export type UsageRequester = <T>(path: string, schema: z.ZodType<T>) => Promise<T>;
