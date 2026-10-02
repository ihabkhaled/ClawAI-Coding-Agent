import { canonicalIp, classifyAddress } from './http-address';
import { HTTP_DEFAULT_PORTS, HTTP_LOCAL_SUFFIXES, HTTP_RULE_HELP } from './http-tool.constants';

import type { HttpHostRule } from './http-tool.types';

const DEFAULT_PORTS: readonly number[] = Object.values(HTTP_DEFAULT_PORTS);

function parseHostAndPort(text: string): { host: string; port: number | undefined } | undefined {
  try {
    const url = new URL(`http://${text}`);
    if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '') {
      return undefined;
    }
    if (url.hash !== '' || !/^(?:\[[0-9a-f:.]+\]|[^:\s/@?#[\]]+)(?::\d{1,5})?$/iu.test(text)) {
      return undefined;
    }
    const port = url.port === '' ? undefined : Number(url.port);
    // `host:80` parses with an empty port, so a rule that names it keeps it.
    const named = /:(\d{1,5})$/u.exec(text);
    return { host: url.hostname, port: port ?? (named === null ? undefined : Number(named[1])) };
  } catch {
    return undefined;
  }
}

/** One allow rule, or the sentence that says what is wrong with it. */
export function parseHostRule(raw: string): HttpHostRule | string {
  const text = raw.trim().toLowerCase();
  const bad = (reason: string): string => `Host rule "${raw}": ${reason} ${HTTP_RULE_HELP}`;
  if (text.length === 0) return bad('is empty.');
  if (text.includes('*') && !text.startsWith('*.')) return bad('a wildcard must be "*.name".');
  const wildcard = text.startsWith('*.');
  const parsed = parseHostAndPort(wildcard ? text.slice(2) : text);
  if (parsed === undefined) return bad('is not a host.');
  const { host, port } = parsed;
  if (port !== undefined && (port < 1 || port > 65_535)) return bad('has a bad port.');
  if (wildcard) {
    const problem = wildcardProblem(host);
    return problem === undefined ? { kind: 'wildcard', host, port } : bad(problem);
  }
  const ip = canonicalIp(host);
  return ip === undefined ? { kind: 'name', host, port } : { kind: 'ip', host: ip, port };
}

/** Why `*.host` is not an acceptable wildcard, or undefined. */
function wildcardProblem(host: string): string | undefined {
  if (host.includes('*') || canonicalIp(host) !== undefined) return 'is not a name.';
  const broad = !host.includes('.') && !HTTP_LOCAL_SUFFIXES.includes(`.${host}`);
  return broad ? 'is too broad.' : undefined;
}

/** Every rule parsed, or the first problem. */
export function parseHostRules(raws: readonly string[]): readonly HttpHostRule[] | string {
  const rules: HttpHostRule[] = [];
  for (const raw of raws) {
    const rule = parseHostRule(raw);
    if (typeof rule === 'string') return rule;
    rules.push(rule);
  }
  return rules;
}

/** The port a URL connects to. */
export function urlPort(url: URL): number {
  return url.port === '' ? (HTTP_DEFAULT_PORTS[url.protocol] ?? 0) : Number(url.port);
}

function portAllowed(rule: HttpHostRule, port: number): boolean {
  return rule.port === undefined ? DEFAULT_PORTS.includes(port) : rule.port === port;
}

function hostMatches(rule: HttpHostRule, hostname: string): boolean {
  const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  if (rule.kind === 'ip') return canonicalIp(bare) === rule.host;
  if (rule.kind === 'wildcard') return bare.endsWith(`.${rule.host}`);
  return bare === rule.host;
}

/** The first rule that admits this URL's host and port, if any. */
export function matchingRule(url: URL, rules: readonly HttpHostRule[]): HttpHostRule | undefined {
  const port = urlPort(url);
  return rules.find((rule) => hostMatches(rule, url.hostname) && portAllowed(rule, port));
}

/** Whether a name is one that lives inside a network on purpose (`claw.local`, `localhost`). */
export function isLocalName(hostname: string): boolean {
  return (
    !hostname.includes('.') ||
    hostname === 'localhost' ||
    HTTP_LOCAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  );
}

/**
 * Why `address` may not be used for `url`, or undefined when it may.
 *
 * Public addresses pass. A private or loopback one passes only when the URL
 * names that exact address, a rule lists it, or the host is a local name; a
 * public-looking name that resolves inside the network is how DNS rebinding
 * reaches internal services, so it is refused. Blocked classes never pass.
 */
export function addressProblem(
  url: URL,
  address: string,
  rules: readonly HttpHostRule[],
): string | undefined {
  const where = classifyAddress(address);
  if (where === 'public') return undefined;
  if (where === 'blocked') {
    return `${url.hostname} resolves to ${address}, a link-local, metadata or reserved address that is never reachable.`;
  }
  const canonical = canonicalIp(address);
  const listed = rules.some(
    (rule) => rule.kind === 'ip' && rule.host === canonical && portAllowed(rule, urlPort(url)),
  );
  const literal = canonicalIp(url.hostname) !== undefined;
  if (listed || literal || isLocalName(url.hostname)) return undefined;
  return `${url.hostname} resolves to ${address}, a ${where} address that is not listed. List ${address}:${String(urlPort(url))} as an allowed host to reach it.`;
}
