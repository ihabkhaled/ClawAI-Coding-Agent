import { RETRY_DEFAULTS } from './retry-policy.constants';

/**
 * A `Retry-After` header as milliseconds, capped so a server cannot park the
 * run for an hour. Both forms are read: whole seconds and an HTTP date. A
 * header that is absent or unreadable is `undefined`, and the backoff decides.
 */
export function parseRetryAfter(
  header: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (header === null || header === undefined) return undefined;
  const text = header.trim();
  if (text.length === 0) return undefined;
  const seconds = /^\d+(?:\.\d+)?$/u.test(text) ? Number(text) : undefined;
  const ms = seconds === undefined ? Date.parse(text) - now : seconds * 1_000;
  if (Number.isNaN(ms)) return undefined;
  return Math.min(Math.max(Math.round(ms), 0), RETRY_DEFAULTS.retryAfterCapMs);
}
