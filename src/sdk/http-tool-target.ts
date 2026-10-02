import dns from 'node:dns';

import { canonicalIp } from './http-address';
import { addressProblem, matchingRule, urlPort } from './http-host-rules';

import type {
  HttpApprovedTarget,
  HttpHostRule,
  HttpResolvedAddress,
  HttpResolver,
} from './http-tool.types';

/** The system resolver, every answer kept so none can be skipped over. */
export const systemResolver: HttpResolver = async (host) => {
  const answers = await dns.promises.lookup(host, { all: true, verbatim: true });
  return answers.flatMap((answer) =>
    answer.family === 4 || answer.family === 6
      ? [{ address: answer.address, family: answer.family }]
      : [],
  );
};

/** The rules as the person wrote them, for the sentence that names what is allowed. */
export function describeRules(rules: readonly HttpHostRule[]): string {
  return rules
    .map((rule) => {
      const host = rule.kind === 'wildcard' ? `*.${rule.host}` : rule.host;
      return rule.port === undefined ? host : `${host}:${String(rule.port)}`;
    })
    .join(', ');
}

/** A refusal the model can act on: it names the host and what is allowed. */
export class HttpRefusal extends Error {}

function literalAddress(url: URL): HttpResolvedAddress | undefined {
  const canonical = canonicalIp(url.hostname);
  if (canonical === undefined) return undefined;
  const bare = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  return { address: bare, family: canonical.includes(':') ? 6 : 4 };
}

/**
 * The address a request may connect to, or a refusal.
 *
 * The host must match a rule, and then every address it resolves to must be
 * acceptable (see `addressProblem`). The name is resolved once, here, and the
 * connection goes to the address returned: nothing resolves it a second time.
 */
export async function approveTarget(
  url: URL,
  rules: readonly HttpHostRule[],
  resolve: HttpResolver,
): Promise<HttpApprovedTarget> {
  const port = urlPort(url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpRefusal(`Only http and https are allowed, not ${url.protocol}`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new HttpRefusal('A URL with credentials is refused.');
  }
  if (matchingRule(url, rules) === undefined) {
    throw new HttpRefusal(
      `${url.hostname}:${String(port)} is not an allowed host. Allowed: ${rules.length === 0 ? 'none' : describeRules(rules)}.`,
    );
  }
  const literal = literalAddress(url);
  const found = literal === undefined ? await resolve(url.hostname) : [literal];
  const first = found[0];
  if (first === undefined) throw new HttpRefusal(`${url.hostname} did not resolve to any address.`);
  for (const answer of found) {
    const problem = addressProblem(url, answer.address, rules);
    if (problem !== undefined) throw new HttpRefusal(problem);
  }
  return { url, address: first };
}
