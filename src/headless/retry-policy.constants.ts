/** How the runtime client backs off when the runtime is briefly unreachable. */
export const RETRY_DEFAULTS = {
  /** The first wait, before jitter. */
  baseMs: 1_000,
  factor: 2,
  /** No single wait grows past this. */
  capMs: 15_000,
  /** Total tries for one call, the first included. */
  maxAttempts: 12,
  /** Total time one call may spend failing and waiting before it gives up. */
  budgetMs: 300_000,
  /** The longest `Retry-After` that is honoured. */
  retryAfterCapMs: 30_000,
  /** A wait is scaled by a random factor in [1 - jitter, 1 + jitter]. */
  jitter: 0.25,
} as const;

/** A 429 is retried this many times in a row (the first try included) before the call fails as rate limited. */
export const RATE_LIMIT_MAX_ATTEMPTS = 4;

/** The status of a rate limit. */
export const RATE_LIMIT_STATUS = 429;

/** Statuses that mean "try again shortly": timeout, rate limit, and the gateway trio. */
export const TRANSIENT_STATUSES: readonly number[] = [408, 429, 502, 503, 504];

/** A 500 is retried only when its body says the runtime state was unavailable. */
export const UNAVAILABLE_BODY_PATTERN = /unavailable/iu;

/** A 400 is retried only when its body says the provider was busy: the same request succeeds shortly. */
export const BUSY_BODY_PATTERN = /\bbusy\b/iu;

/** Error codes Node and undici put on a failed connection or a dropped socket. */
export const TRANSIENT_NETWORK_CODES: readonly string[] = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
];

/**
 * Messages of a transport failure that carries no code: undici's `fetch failed`,
 * a body cut off by the server (`terminated`), and Node's `socket hang up`.
 */
export const TRANSIENT_NETWORK_MESSAGE =
  /socket hang up|fetch failed|other side closed|^terminated$|network error|connection (?:was )?(?:closed|reset)/iu;

/** The `code` a retry notice carries for a transport failure that has no code of its own. */
export const NETWORK_FAILURE_CODE = 'NETWORK';

/** The code the runtime's stream reports when its state store is briefly away. */
export const STREAM_UNAVAILABLE_CODE = 'RUNTIME_STATE_UNAVAILABLE';

/** The frame the runtime sends when the stream itself fails. */
export const STREAM_ERROR_EVENT_TYPE = 'stream.error';

/** How deep an error's `cause` chain is searched for a network code. */
export const CAUSE_DEPTH = 4;
