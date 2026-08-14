/** How many dot-separated segments a JWS compact serialization carries. */
export const JWT_SEGMENT_COUNT = 3;

/** JWT `exp` is expressed in seconds; every clock in this extension is in ms. */
export const MILLISECONDS_PER_SECOND = 1_000;

/**
 * How long before an access token expires the extension rotates it.
 *
 * Waiting for the 401 was the whole defect: a long agent run would send a
 * request with a token that died mid-flight, and every failure that escaped the
 * one retry dropped the panel to "Connect to ClawAI". Two minutes covers a slow
 * refresh round trip plus modest clock drift between the editor and the
 * backend, and is far below the fifteen-minute access-token lifetime, so a
 * request never rotates a token that still had most of its life left.
 */
export const ACCESS_TOKEN_REFRESH_SKEW_MS = 120_000;
