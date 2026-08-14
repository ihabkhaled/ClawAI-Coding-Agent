import { Buffer } from 'node:buffer';

import { z } from 'zod';

import { JWT_SEGMENT_COUNT, MILLISECONDS_PER_SECOND } from './access-token-expiry.constants';

const accessTokenClaimsSchema = z
  .object({
    exp: z.number().int().positive(),
  })
  .loose();

/**
 * When the backend stops accepting this access token, in epoch milliseconds.
 *
 * The stored token pair only carries `expiresIn`, a duration with no issue
 * time, so it cannot answer "is this token nearly dead?" after the extension
 * host restarts. The `exp` claim is absolute and is the same value the backend
 * guard enforces, so it is read straight from the token. The signature is
 * deliberately not verified: the extension holds no signing secret and this
 * value only schedules a refresh — the backend remains the only authority on
 * whether a token is accepted.
 *
 * Returns null for anything that is not a JWT carrying a usable `exp`, which
 * disables proactive refresh rather than guessing an expiry.
 */
export function accessTokenExpiresAt(accessToken: string): number | null {
  const segments = accessToken.split('.');
  if (segments.length !== JWT_SEGMENT_COUNT) {
    return null;
  }
  const payload = segments[1];
  if (payload === undefined || payload.length === 0) {
    return null;
  }
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = accessTokenClaimsSchema.safeParse(claims);
  return parsed.success ? parsed.data.exp * MILLISECONDS_PER_SECOND : null;
}

/**
 * Whether the access token is close enough to expiry to rotate it now.
 *
 * An already-expired token also answers true, so a host that was asleep past
 * the expiry refreshes on its first request instead of spending a 401 first.
 */
export function accessTokenNeedsRefresh(
  accessToken: string,
  nowMs: number,
  skewMs: number,
): boolean {
  const expiresAt = accessTokenExpiresAt(accessToken);
  return expiresAt !== null && expiresAt - nowMs <= skewMs;
}
