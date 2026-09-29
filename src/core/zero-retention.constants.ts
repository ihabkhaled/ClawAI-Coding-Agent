import type {
  ZeroRetentionBlockedFeature,
  ZeroRetentionBlockedRoute,
  ZeroRetentionPosture,
} from './zero-retention.types';

/** Setting key under the `clawAI` section. */
export const ZERO_RETENTION_SETTING = 'zeroDataRetention';

/**
 * Sent on every backend request while zero data retention is on.
 *
 * A header rather than a body field so it reaches every route, including the
 * ones whose body schema is strict, and so a backend that does not know it yet
 * ignores it instead of rejecting the request.
 */
export const ZERO_RETENTION_HEADER = 'X-Claw-Zero-Retention';

export const ZERO_RETENTION_OFF: ZeroRetentionPosture = { active: false, source: 'off' };

/**
 * Routes whose whole purpose is to keep content on the server.
 *
 * Refused on this machine before the request is sent: a flag the server might
 * not honour yet is not a promise, and never sending the bytes is.
 */
export const ZERO_RETENTION_BLOCKED_ROUTES: readonly ZeroRetentionBlockedRoute[] = [
  { method: 'POST', pattern: /^\/files\/upload(?:[/?]|$)/u, feature: 'upload' },
  { method: 'POST', pattern: /^\/artifacts(?:[/?]|$)/u, feature: 'artifact-publish' },
  { method: 'POST', pattern: /^\/chat-threads\/[^/?]+\/share(?:[/?]|$)/u, feature: 'share' },
  { method: 'PATCH', pattern: /^\/chat-threads\/[^/?]+\/share(?:[/?]|$)/u, feature: 'share' },
];

/** English refusal reasons; the translated ones come from `zeroRetentionRefusalMessage`. */
export const ZERO_RETENTION_REFUSALS: Readonly<Record<ZeroRetentionBlockedFeature, string>> = {
  upload:
    'Zero data retention is on, so files are not uploaded: an upload is stored on the server.',
  'artifact-publish':
    'Zero data retention is on, so nothing is published: a published page is stored on the server.',
  share:
    'Zero data retention is on, so this chat cannot be shared: a share is stored on the server.',
};
