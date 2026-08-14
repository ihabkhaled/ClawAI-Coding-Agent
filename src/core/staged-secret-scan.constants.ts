/**
 * Credential formats that are unambiguous wherever they appear.
 *
 * Each of these encodes its own issuer, so a match is a leak regardless of what
 * it is assigned to or whether it is quoted. They are checked against added
 * lines with no further filtering.
 */
export const STAGED_SECRET_FORMAT_PATTERNS: readonly RegExp[] = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/u,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/u,
  /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/u,
  /\bAIza[0-9A-Za-z_-]{35}\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
];

/**
 * Names whose assigned value is treated as a candidate credential.
 *
 * Unlike the formats above, a hit here proves nothing on its own — the value
 * still has to look like a secret. `\b` matters: without it `rawToken` matched
 * as `token`, which is exactly how a password-reset feature became impossible
 * to commit.
 */
export const STAGED_SECRET_ASSIGNMENT_PATTERN =
  /\b(?:api[-_]?key|apikey|password|passwd|pwd|secret|token|credential|private[-_]?key)\b["']?\s*[:=]\s*(?<value>"[^"\n]*"|'[^'\n]*'|`[^`\n]*`|[^\s"'`,;)}\]]+)/giu;

/** Values a developer writes precisely because they are not the real thing. */
export const STAGED_SECRET_PLACEHOLDER_MARKERS: readonly string[] = [
  'changeme',
  'redacted',
  'example',
  'placeholder',
  'your-',
  'your_',
  'xxx',
  'dummy',
  'sample',
  'replace',
  '<',
  '***',
];

/**
 * Shortest value worth judging. Real credentials are longer than this; the
 * strings below it are overwhelmingly types, flags and short literals —
 * `string)`, `true`, `null` — which is what the previous eight-character floor
 * kept flagging.
 */
export const STAGED_SECRET_MIN_VALUE_LENGTH = 12;

/**
 * Shannon entropy, in bits per character, above which a value is treated as
 * generated rather than written.
 *
 * Calibrated against the strings this has to separate. The fixtures in a
 * password-reset test suite — `reset-token-abc`, `secret-token-xyz` — sit near
 * 3.3; a generated credential of the same length sits above 3.9. 3.6 leaves
 * room on both sides, and anything that reads as words is rejected by shape
 * before entropy is consulted at all.
 */
export const STAGED_SECRET_MIN_ENTROPY_BITS = 3.6;
