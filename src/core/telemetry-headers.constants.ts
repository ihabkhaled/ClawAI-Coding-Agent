/** SecretStorage key for the OTLP export headers. They are credentials, so they never live in settings. */
export const TELEMETRY_HEADERS_SECRET_KEY = 'clawAI.telemetry.headers';

/** A collector needs one or two headers; more than this is a paste mistake, not a configuration. */
export const TELEMETRY_HEADERS_MAX_ENTRIES = 32;

/** Longest header value accepted, generous enough for a signed JWT. */
export const TELEMETRY_HEADER_VALUE_MAX_LENGTH = 8_192;

/** An HTTP header field name: an RFC 9110 token. */
export const TELEMETRY_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,256}$/u;
