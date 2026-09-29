import { z } from 'zod';

import { globMatches } from './glob-match';
import { ruleMatches } from './policy-rule-match';

import type { OrganizationPolicyConstraints, PolicyRequest, PolicyV2Decision } from './policy-v2';

const globGroups = z
  .array(z.array(z.string().min(1).max(500)).max(200))
  .max(32)
  .default([]);

/**
 * Trust lists, one group per organization.
 *
 * Allow-shaped lists can still only narrow: outside the list a call is denied
 * or asked, and inside it nothing is granted that the mode would not grant.
 * Each inner array is one organization's list, and a subject must match every
 * group — a user in two organizations is held to both, which a flattened union
 * of globs would silently loosen. An empty outer array constrains nothing.
 */
export const organizationTrustSchema = z
  .object({
    repositories: globGroups,
    domains: globGroups,
    commands: globGroups,
  })
  .strict();

const matchesEveryGroup = (groups: readonly (readonly string[])[], value: string): boolean =>
  groups.every((group) => group.some((glob) => globMatches(glob, value)));

const decision = (
  request: PolicyRequest,
  outcome: 'ask' | 'deny',
  code: string,
): PolicyV2Decision => ({ outcome, code, risk: request.risk, immutable: false });

function repositoryUntrusted(
  request: PolicyRequest,
  groups: readonly (readonly string[])[],
): boolean {
  if (groups.length === 0 || request.effect === 'read') return false;
  // A workspace with no remote cannot prove it is a trusted repository.
  const repository = request.subject?.repository;
  return repository === undefined || !matchesEveryGroup(groups, repository);
}

function domainUntrusted(request: PolicyRequest, groups: readonly (readonly string[])[]): boolean {
  if (groups.length === 0) return false;
  return (request.subject?.domains ?? []).some((domain) => !matchesEveryGroup(groups, domain));
}

function commandUntrusted(request: PolicyRequest, groups: readonly (readonly string[])[]): boolean {
  const command = request.subject?.command;
  return groups.length > 0 && command !== undefined && !matchesEveryGroup(groups, command);
}

function organizationRuleDecision(
  request: PolicyRequest,
  organization: OrganizationPolicyConstraints,
): PolicyV2Decision | undefined {
  const subject = request.subject;
  if (subject === undefined) return undefined;
  const matched = organization.rules.filter((rule) => ruleMatches(rule, subject));
  if (matched.length === 0) return undefined;
  return matched.some((rule) => rule.outcome === 'deny')
    ? decision(request, 'deny', 'ORGANIZATION_RULE_DENIED')
    : decision(request, 'ask', 'ORGANIZATION_RULE_APPROVAL_REQUIRED');
}

/**
 * Organization hard-deny rules and trust lists, every deny before any ask.
 */
export function organizationTrustDecision(
  request: PolicyRequest,
  organization: OrganizationPolicyConstraints,
): PolicyV2Decision | undefined {
  const ruled = organizationRuleDecision(request, organization);
  if (ruled?.outcome === 'deny') return ruled;
  // An empty group is an organization with no list, which constrains nothing.
  const constraining = (groups: readonly (readonly string[])[]): readonly (readonly string[])[] =>
    groups.filter((group) => group.length > 0);
  const { trust } = organization;
  if (repositoryUntrusted(request, constraining(trust.repositories)))
    return decision(request, 'deny', 'ORGANIZATION_REPOSITORY_UNTRUSTED');
  if (domainUntrusted(request, constraining(trust.domains)))
    return decision(request, 'deny', 'ORGANIZATION_DOMAIN_UNTRUSTED');
  if (commandUntrusted(request, constraining(trust.commands)))
    return decision(request, 'ask', 'ORGANIZATION_COMMAND_UNTRUSTED');
  return ruled;
}
