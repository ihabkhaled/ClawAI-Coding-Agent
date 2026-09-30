import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { PluginFailure } from '../core/plugin-failure';
import { isPrivateAddress, isPrivateHostLiteral } from '../core/private-address';

import type { HostLookup, PluginNetworkOptions } from './plugin-network-guard.types';

/** Every address the system resolver returns for the host, not just the first. */
export const systemHostLookup: HostLookup = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

/**
 * Refuses a URL whose host is, or resolves to, a private, loopback, link-local
 * or metadata address. Checks the literal host first, then every resolved
 * address: a public-looking name can point at 169.254.169.254.
 */
export async function assertPublicUrl(
  url: string,
  options: PluginNetworkOptions = {},
): Promise<void> {
  if (options.allowPrivate === true) return;
  if (!URL.canParse(url)) throw new PluginFailure('invalid-source', 'not a URL');
  const parsed = new URL(url);
  if (isPrivateHostLiteral(parsed)) throw new PluginFailure('invalid-source', 'private address');
  const host = parsed.hostname.replace(/^\[|\]$/gu, '');
  if (isIP(host) !== 0) return;
  let addresses: readonly string[];
  try {
    addresses = await (options.lookup ?? systemHostLookup)(host);
  } catch {
    throw new PluginFailure('unreachable', host);
  }
  if (addresses.length === 0) throw new PluginFailure('unreachable', host);
  if (addresses.some((address) => isPrivateAddress(address))) {
    throw new PluginFailure('invalid-source', 'private address');
  }
}
