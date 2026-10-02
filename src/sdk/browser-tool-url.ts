import { isPrivateAddress } from '../core/web-research';

import { canonicalIp, classifyAddress } from './http-address';

const WEB_PROTOCOLS = new Set(['http:', 'https:']);
/** Schemes a page may use for its own resources; never as a place to navigate to. */
const INLINE_PROTOCOLS = new Set(['data:', 'blob:', 'about:']);
const DEFAULT_PORTS: Readonly<Record<string, string>> = { 'http:': '80', 'https:': '443' };

/** A host as the allow list and the address check both spell it: lower case, no brackets, no trailing dot. */
export function normalizedHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.+$/u, '');
}

/** Whether a name stands for this machine or a private network rather than the public web. */
export function isLocalHost(hostname: string): boolean {
  const host = normalizedHost(hostname);
  if (isPrivateAddress(host) || isPrivateAddress(`[${host}]`)) return true;
  if (host.includes(':')) return true;
  if (host.endsWith('.local') || host.endsWith('.localhost')) return true;
  if (!host.includes('.')) return true;
  return canonicalIp(host) !== undefined && classifyAddress(host) !== 'public';
}

/** Whether the operator listed this host (`name`, or `name:port` to pin a port; a default port counts). */
export function isListedHost(
  hostname: string,
  port: string,
  allowHosts: readonly string[],
): boolean {
  const host = normalizedHost(hostname);
  return allowHosts.some((entry) => {
    const listed = normalizedHost(entry);
    return listed === host || (port.length > 0 && listed === `${host}:${port}`);
  });
}

function isListed(url: URL, allowHosts: readonly string[]): boolean {
  const port = url.port.length > 0 ? url.port : (DEFAULT_PORTS[url.protocol] ?? '');
  return isListedHost(url.hostname, port, allowHosts);
}

/** Why this address may not be loaded, or undefined when it may. */
export function addressProblem(
  url: URL,
  options: { readonly allowHosts: readonly string[]; readonly navigation: boolean },
): string | undefined {
  if (INLINE_PROTOCOLS.has(url.protocol)) {
    return options.navigation ? `The browser does not open ${url.protocol} addresses` : undefined;
  }
  if (!WEB_PROTOCOLS.has(url.protocol)) {
    return `Only http and https pages may be opened, not ${url.protocol}`;
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return 'An address carrying credentials will not be opened';
  }
  if (isLocalHost(url.hostname) && !isListed(url, options.allowHosts)) {
    return (
      `${url.hostname} is a private or local host. The operator must allow it with ` +
      `--browser-allow-host ${url.hostname}`
    );
  }
  return undefined;
}

/** The URL `open` may load, or an error saying why not. */
export function assertBrowsableUrl(raw: unknown, allowHosts: readonly string[]): URL {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('browser.page open needs a "url".');
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`Not a URL: ${raw.slice(0, 200)}`);
  }
  const problem = addressProblem(url, { allowHosts, navigation: true });
  if (problem !== undefined) throw new Error(problem);
  return url;
}

/** The host entries an operator gave, trimmed; a blank or malformed one is a mistake worth naming. */
export function parseAllowHosts(entries: readonly string[]): readonly string[] {
  return entries
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      if (/[/\s@]/u.test(entry)) {
        throw new RangeError(`--browser-allow-host takes a host name, not "${entry}".`);
      }
      return entry;
    });
}
