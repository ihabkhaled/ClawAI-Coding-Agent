import { isPrivateAddress } from '../core/web-research';

const WEB_PROTOCOLS = new Set(['http:', 'https:']);
/** Schemes a page may use for its own resources; never as a place to navigate to. */
const INLINE_PROTOCOLS = new Set(['data:', 'blob:', 'about:']);

/** A host as the allow list and the address check both spell it: lower case, no brackets. */
function normalizedHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, '');
}

/** Whether a name stands for this machine or a private network rather than the public web. */
function isLocalHost(hostname: string): boolean {
  const host = normalizedHost(hostname);
  if (isPrivateAddress(host) || isPrivateAddress(`[${host}]`)) return true;
  if (host.includes(':')) return true;
  if (host.endsWith('.local')) return true;
  if (!host.includes('.')) return true;
  const octets = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/u.exec(host);
  if (octets === null) return false;
  const [first, second] = [Number(octets[1]), Number(octets[2])];
  return first === 0 || (first === 100 && second >= 64 && second <= 127);
}

/** Whether the operator listed this host (`name`, or `name:port` to pin a port). */
function isListed(url: URL, allowHosts: readonly string[]): boolean {
  const host = normalizedHost(url.hostname);
  const withPort = url.port.length > 0 ? `${host}:${url.port}` : host;
  return allowHosts.some((entry) => {
    const listed = normalizedHost(entry);
    return listed === host || listed === withPort;
  });
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
