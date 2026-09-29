import { globMatches } from './glob-match';

import type { PolicyRule, PolicySubject } from './policy-v2';

/**
 * Whether one rule matches one subject: every field the rule names must match.
 *
 * Shared by project rules and organization rules so the two sources cannot
 * drift into matching the same rule differently.
 */
export function ruleMatches(rule: PolicyRule, subject: PolicySubject): boolean {
  if (rule.tool !== undefined && rule.tool !== subject.tool) return false;
  if (rule.operation !== undefined && rule.operation !== subject.operation) return false;
  if (
    rule.pathGlob !== undefined &&
    !subject.paths.some((path) => globMatches(rule.pathGlob ?? '', path))
  ) {
    return false;
  }
  if (
    rule.commandGlob !== undefined &&
    (subject.command === undefined || !globMatches(rule.commandGlob, subject.command))
  ) {
    return false;
  }
  // A domain rule that names a host no call touched does not match. A call
  // with no hosts at all can therefore never satisfy one, which is right: a
  // rule about where requests may go says nothing about a file read.
  if (
    rule.domainGlob !== undefined &&
    !subject.domains.some((domain) => globMatches(rule.domainGlob ?? '', domain))
  ) {
    return false;
  }
  return true;
}
