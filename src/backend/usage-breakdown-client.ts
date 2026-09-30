import {
  ACCOUNT_USAGE_BREAKDOWN_PATH,
  MEMBER_ORGANIZATIONS_PATH,
  ORGANIZATION_USAGE_MAX_ORGANIZATIONS,
  ORGANIZATION_USAGE_PATH_PREFIX,
} from './usage-breakdown-client.constants';
import {
  accountUsageBreakdownSchema,
  memberOrganizationsSchema,
  organizationUsageSchema,
} from './usage-breakdown-contracts';

import type {
  AccountUsageSections,
  NamedOrganizationUsage,
  UsageRequester,
} from './usage-breakdown-client.types';
import type { AccountUsageBreakdown } from './usage-breakdown-contracts';

async function accountBreakdown(
  request: UsageRequester,
): Promise<AccountUsageBreakdown | undefined> {
  try {
    return await request(ACCOUNT_USAGE_BREAKDOWN_PATH, accountUsageBreakdownSchema);
  } catch {
    return undefined;
  }
}

async function organizationUsage(
  request: UsageRequester,
  organization: { id: string; name: string },
): Promise<NamedOrganizationUsage | undefined> {
  try {
    const usage = await request(
      `${ORGANIZATION_USAGE_PATH_PREFIX}/${encodeURIComponent(organization.id)}/usage`,
      organizationUsageSchema,
    );
    return { name: organization.name, usage };
  } catch {
    return undefined;
  }
}

async function administeredOrganizations(
  request: UsageRequester,
): Promise<NamedOrganizationUsage[]> {
  try {
    const organizations = await request(MEMBER_ORGANIZATIONS_PATH, memberOrganizationsSchema);
    const answers = await Promise.all(
      organizations
        .slice(0, ORGANIZATION_USAGE_MAX_ORGANIZATIONS)
        .map((organization) => organizationUsage(request, organization)),
    );
    return answers.filter((answer): answer is NamedOrganizationUsage => answer !== undefined);
  } catch {
    return [];
  }
}

/**
 * The server-side usage the dialog adds under the session numbers.
 *
 * Every read is optional. An older backend without the breakdown answers 404
 * and the section is left out; an organization answers 200 only for its
 * owners and admins, so a plain member — who gets 403 — sees no organization
 * section at all rather than an error. The dialog must open either way.
 */
export async function fetchAccountUsageSections(
  request: UsageRequester,
): Promise<AccountUsageSections> {
  const [account, organizations] = await Promise.all([
    accountBreakdown(request),
    administeredOrganizations(request),
  ]);
  return account === undefined ? { organizations } : { account, organizations };
}
