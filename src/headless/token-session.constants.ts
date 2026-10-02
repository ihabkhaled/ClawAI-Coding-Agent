/** The backend route that trades a refresh token for a new pair. */
export const REFRESH_PATH = '/auth/refresh';

/** Rotate once this fraction of the access token's life has passed. */
export const ROTATE_AT_LIFE_FRACTION = 0.8;

/** A request made with a token that expires inside this window rotates first (capped at 20% of the life). */
export const REQUEST_SKEW_MS = 60_000;

/** The share of the life the request skew may not exceed, so a very short token is not always "expiring". */
export const REQUEST_SKEW_MAX_LIFE_FRACTION = 0.2;

/** The rotation time for a token whose life cannot be read (not a JWT with `exp`). */
export const FALLBACK_ROTATE_AFTER_MS = 600_000;

/** Statuses that mean the refresh token itself is not accepted: asking again gets the same answer. */
export const REFRESH_REFUSED_STATUSES: readonly number[] = [400, 401, 403];
