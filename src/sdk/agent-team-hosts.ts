import { parseHostRule } from './http-host-rules';
import { HTTP_DEFAULT_PORTS } from './http-tool.constants';

import type { HttpHostRule } from './http-tool.types';

const DEFAULT_PORTS: readonly number[] = Object.values(HTTP_DEFAULT_PORTS);

/** Whether `parent` admits every port `child` admits: no port means the default web ports only. */
function portsWithin(child: HttpHostRule, parent: HttpHostRule): boolean {
  if (parent.port === undefined)
    return child.port === undefined || DEFAULT_PORTS.includes(child.port);
  return child.port === parent.port;
}

function namesWithin(child: HttpHostRule, parent: HttpHostRule): boolean {
  if (parent.kind === 'wildcard') {
    return (
      child.kind !== 'ip' &&
      (child.host.endsWith(`.${parent.host}`) ||
        (child.kind === 'wildcard' && child.host === parent.host))
    );
  }
  return child.kind === parent.kind && child.host === parent.host;
}

/** Whether every address the child rule admits is one some parent rule admits. */
export function ruleWithin(child: HttpHostRule, parents: readonly HttpHostRule[]): boolean {
  return parents.some((parent) => portsWithin(child, parent) && namesWithin(child, parent));
}

/** The sentence refusing the first child host rule the parent's rules do not cover, or undefined. */
export function httpHostsProblem(
  child: readonly string[],
  parent: readonly string[] | undefined,
): string | undefined {
  const parentRules: HttpHostRule[] = [];
  for (const raw of parent ?? []) {
    const rule = parseHostRule(raw);
    if (typeof rule !== 'string') parentRules.push(rule);
  }
  for (const raw of child) {
    const rule = parseHostRule(raw);
    if (typeof rule === 'string') return rule;
    if (!ruleWithin(rule, parentRules)) {
      return `http host "${raw}" is not inside the hosts you may reach (${(parent ?? []).join(', ') || 'none'}).`;
    }
  }
  return undefined;
}

/** The first browser host the parent has not listed, or undefined; hosts compare case-insensitively. */
export function browserHostsProblem(
  child: readonly string[],
  parent: readonly string[] | undefined,
): string | undefined {
  const listed = new Set((parent ?? []).map((host) => host.trim().toLowerCase()));
  const missing = child.find((host) => !listed.has(host.trim().toLowerCase()));
  return missing === undefined
    ? undefined
    : `browser host "${missing}" is not one you may open (${(parent ?? []).join(', ') || 'none'}).`;
}
