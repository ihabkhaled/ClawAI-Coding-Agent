import { z } from 'zod';

import { marketplaceAllowed } from './plugin-marketplace';

/** Same shape as the project policy's `allowedPluginMarketplaces`. */
const marketplaceAllowlistSchema = z.array(z.string().min(1).max(2_048)).max(100);

/**
 * The organization's `allowedPluginMarketplaces`, from the managed policy.
 *
 * Absent means the organization has no opinion. A value that does not parse
 * refuses every marketplace: a restriction that could not be read is still a
 * restriction, and reading it as none would invert it.
 */
export function readOrganizationMarketplaceAllowlist(
  candidate: unknown,
): readonly string[] | undefined {
  if (candidate === undefined || candidate === null) return undefined;
  return marketplaceAllowlistSchema.safeParse(candidate).data ?? [];
}

/**
 * The allowlist that applies, organization first.
 *
 * The organization's list wins: a project cannot add a marketplace to it. A
 * project may still narrow it further, so the result is the organization's
 * entries the project also names. Either side alone applies as written.
 */
export function effectiveMarketplaceAllowlist(
  organization: readonly string[] | undefined,
  project: readonly string[] | undefined,
): readonly string[] | undefined {
  if (organization === undefined) return project;
  if (project === undefined) return organization;
  return organization.filter((source) => marketplaceAllowed(source, project));
}
