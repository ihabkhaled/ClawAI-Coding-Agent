import { z } from 'zod';

import {
  DEFAULT_PLUGIN_SIGNATURE_POLICY,
  PLUGIN_SIGNATURE_POLICIES,
  PUBLISHER_ID_PATTERN,
} from './plugin-signature.constants';

import type { PluginSignaturePolicy, TrustedPublishers } from './plugin-signature.types';

/** Same shape as the policy file's `trustedPluginPublishers`. */
export const trustedPublishersSchema = z.record(
  z.string().regex(PUBLISHER_ID_PATTERN),
  z.string().min(1).max(200),
);

/**
 * A trust list from any layer, as it arrived.
 *
 * Absent means that layer has no opinion. A value that does not parse trusts
 * nobody: a restriction that could not be read is still a restriction.
 */
export function readTrustedPublishers(candidate: unknown): TrustedPublishers | undefined {
  if (candidate === undefined || candidate === null) return undefined;
  return trustedPublishersSchema.safeParse(candidate).data ?? {};
}

function narrowed(base: TrustedPublishers, project: TrustedPublishers): TrustedPublishers {
  return Object.fromEntries(
    Object.entries(base).filter(([id, key]) => Object.hasOwn(project, id) && project[id] === key),
  );
}

/**
 * The publishers that are trusted, organization first.
 *
 * The organization's list replaces the user's setting outright: a member
 * cannot add a key to it. A project policy is repository content, so it can
 * only narrow — the result keeps the entries it also names, with the same key.
 * A project that names a publisher nobody else trusts trusts nobody.
 */
export function effectiveTrustedPublishers(
  organization: TrustedPublishers | undefined,
  project: TrustedPublishers | undefined,
  user: TrustedPublishers,
): TrustedPublishers {
  const base = organization ?? user;
  return project === undefined ? base : narrowed(base, project);
}

/** The configured mode; anything unrecognised falls back to the default. */
export function readSignaturePolicy(candidate: unknown): PluginSignaturePolicy {
  return (
    PLUGIN_SIGNATURE_POLICIES.find((mode) => mode === candidate) ?? DEFAULT_PLUGIN_SIGNATURE_POLICY
  );
}
