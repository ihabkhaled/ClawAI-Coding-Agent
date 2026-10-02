import { toolPatternsProblem } from './agent-inputs';
import {
  DEV_PROFILE_PATTERNS,
  MINIMAL_PROFILE_PATTERNS,
  TOOLS_PROFILE_HELP,
  TOOLS_PROFILE_MAX_ITEMS,
  TOOLS_PROFILE_NAMES,
} from './tools-profile.constants';

import type { ResolvedToolsProfile } from './tools-profile.types';

function splitItems(spec: string): readonly string[] {
  return spec
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isPattern(item: string): boolean {
  return item.includes('.') || item.includes('*');
}

/** The message naming what is wrong with a profile spec, or undefined when it is usable. */
export function toolsProfileProblem(spec: string): string | undefined {
  const items = splitItems(spec);
  if (items.length === 0) return `A tools profile needs a name or patterns. ${TOOLS_PROFILE_HELP}`;
  if (items.length > TOOLS_PROFILE_MAX_ITEMS) {
    return `A tools profile holds at most ${String(TOOLS_PROFILE_MAX_ITEMS)} items.`;
  }
  const unknown = items.find((item) => !TOOLS_PROFILE_NAMES.includes(item) && !isPattern(item));
  if (unknown !== undefined) return `Unknown tools profile "${unknown}". ${TOOLS_PROFILE_HELP}`;
  return toolPatternsProblem(items.filter(isPattern));
}

function patternsOf(item: string): readonly string[] {
  if (item === 'minimal') return MINIMAL_PROFILE_PATTERNS;
  if (item === 'dev') return DEV_PROFILE_PATTERNS;
  return [item];
}

/**
 * What a profile spec means: a comma list of `minimal`, `dev`, `full` and tool
 * patterns, added together (`dev,browser.page`). `full` removes the limit.
 *
 * A profile only narrows. It is applied on top of the grants (`--allow-tools`,
 * the permission mode) and the allow and deny lists, so it can make the model's
 * catalog smaller and can never make a refused call allowed.
 */
export function resolveToolsProfile(spec: string): ResolvedToolsProfile {
  const items = splitItems(spec);
  const wantsPlan = items.includes('dev') || items.some((item) => item.startsWith('task.plan'));
  if (items.includes('full')) return { allow: undefined, taskPlan: wantsPlan };
  return { allow: [...new Set(items.flatMap(patternsOf))], taskPlan: wantsPlan };
}
