import dns from 'node:dns';

import { isListedHost, isLocalHost, normalizedHost } from './browser-tool-url';
import { canonicalIp, classifyAddress } from './http-address';

import type { BrowserEgressDecision, BrowserResolver } from './browser-egress.types';

/** The system resolver; every answer is kept so none can be skipped over. */
export const systemBrowserResolver: BrowserResolver = async (host) => {
  const answers = await dns.promises.lookup(host, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
};

/**
 * Where a connection from the browser may go.
 *
 * The browser's own request hooks see names, never the address a name turns
 * into, and do not see WebSockets or workers at all. The egress proxy asks
 * this instead, for every connection the browser makes: a host that is not
 * listed must be a public name that resolves only to public addresses, so a
 * public-looking name that points at 127.0.0.1 (`localtest.me`, `nip.io`) is
 * refused. The address that passed is the one returned, and the proxy connects
 * to it, so the browser never resolves the name a second time.
 */
export async function egressDecision(
  target: { readonly host: string; readonly port: number },
  allowHosts: readonly string[],
  resolve: BrowserResolver,
): Promise<BrowserEgressDecision> {
  const host = normalizedHost(target.host);
  const listed = isListedHost(host, String(target.port), allowHosts);
  if (!listed && isLocalHost(host)) {
    return { refused: `${host} is a private or local host that the operator has not allowed` };
  }
  let addresses: readonly string[];
  try {
    addresses = canonicalIp(host) === undefined ? await resolve(host) : [host];
  } catch {
    return { refused: `${host} did not resolve to any address` };
  }
  const first = addresses[0];
  if (first === undefined) return { refused: `${host} did not resolve to any address` };
  const bad = listed ? undefined : addresses.find((a) => classifyAddress(a) !== 'public');
  if (bad !== undefined) {
    return {
      refused: `${host} resolves to ${bad}, a private or local address. The operator must allow it with --browser-allow-host ${host}`,
    };
  }
  return { address: first };
}
