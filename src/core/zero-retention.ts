import {
  ZERO_RETENTION_BLOCKED_ROUTES,
  ZERO_RETENTION_HEADER,
  ZERO_RETENTION_OFF,
  ZERO_RETENTION_THREAD_TITLE,
} from './zero-retention.constants';

import type {
  ZeroRetentionBlockedFeature,
  ZeroRetentionInput,
  ZeroRetentionMethod,
  ZeroRetentionPosture,
} from './zero-retention.types';

/**
 * Whether zero data retention is on, and who turned it on.
 *
 * An organization whose retention ceiling is zero days forces it regardless of
 * the setting: `0` means disabled, so a zero-day ceiling is a ceiling of no
 * retention at all. The organization wins over the user because the setting
 * can only tighten, never loosen, what the organization allows.
 */
export function resolveZeroRetention(input: ZeroRetentionInput): ZeroRetentionPosture {
  if (input.organizationRetentionDays === 0) return { active: true, source: 'organization' };
  if (input.setting) return { active: true, source: 'setting' };
  return ZERO_RETENTION_OFF;
}

/** The server-storing feature a request would use, or undefined when it stores nothing. */
export function zeroRetentionBlockedFeature(
  method: ZeroRetentionMethod,
  path: string,
): ZeroRetentionBlockedFeature | undefined {
  const route = ZERO_RETENTION_BLOCKED_ROUTES.find(
    (candidate) => candidate.method === method && candidate.pattern.test(path),
  );
  return route?.feature;
}

/** Headers that carry the posture to the backend. Empty when retention is normal. */
export function zeroRetentionHeaders(posture: ZeroRetentionPosture): Record<string, string> {
  return posture.active ? { [ZERO_RETENTION_HEADER]: '1' } : {};
}

/** The title a new thread is created with: the prompt's opening, or a neutral one under retention. */
export function threadTitleFor(content: string, posture: ZeroRetentionPosture): string {
  return posture.active ? ZERO_RETENTION_THREAD_TITLE : content.trim().slice(0, 80);
}

export function samePosture(left: ZeroRetentionPosture, right: ZeroRetentionPosture): boolean {
  return left.active === right.active && left.source === right.source;
}
