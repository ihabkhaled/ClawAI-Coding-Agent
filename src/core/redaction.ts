const sensitiveKeyPattern =
  /(?:access.?token|refresh.?token|authorization|cookie|password|passphrase|secret|api.?key|client.?secret|credential|token)/iu;
const bearerPattern = /(\bBearer\s+)[A-Za-z0-9._~+/=-]+/giu;
/** `Authorization: Basic …` carries a reusable password in base64. */
const authorizationSchemePattern =
  /(\bAuthorization\s*[:=]\s*(?:Basic|Digest|Token)\s+)[^\s"',}]+/giu;
/** `scheme://user:password@host` and `https://TOKEN@host` put the secret in the URL. */
const urlUserinfoPattern = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/giu;
const sensitiveQueryPattern =
  /([?&#](?:access_token|refresh_token|id_token|token|api_key|apikey|key|secret|password|code|authorization_code)=)[^&\s]+/giu;
/** A JSON `"code"` member: an OAuth code is single-use but valid until spent. */
const jsonOauthPattern = /("(?:code|authorization_code|id_token)"\s*:\s*")[^"]+/giu;
/** The whole header: `Cookie: a=1; sid=…` carries several secrets, not one. */
const cookieHeaderPattern = /(\b(?:Set-)?Cookie\s*:\s*)[^\r\n"]+/giu;
const privateKeyPattern =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu;
const jwtPattern = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/gu;
/** Vendor key formats are a secret wherever they appear, named or not. */
const vendorKeyPattern =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{12,}|xox[abprs]-[A-Za-z0-9-]{10,})/gu;

/**
 * A word boundary does not sit between an underscore and a letter, so it
 * misses the shape secrets most often take in a shell: `GITHUB_TOKEN=…`,
 * `AWS_SECRET_ACCESS_KEY=…`. An underscore is accepted as a boundary for
 * that reason, and an underscore-joined tail is allowed after the keyword so
 * `AWS_SECRET_ACCESS_KEY=` matches. The tail must start with an underscore:
 * `SECRETARY_NAME=Alice` is a name, not a secret, and redacting it would make
 * a log useless to protect nothing. Every screenful of `env` was passing
 * through unredacted before this.
 */
const sensitiveAssignmentPattern =
  /((?:\b|_)(?:access.?token|refresh.?token|cookie|password|passphrase|secret|api.?key|client.?secret|credential|token)(?:_[A-Za-z0-9_]*)?["']?\s*[:=]\s*["']?)[^"',&\s}]+/giu;

function redactRecord(
  value: Record<string, unknown>,
  seen: WeakSet<object>,
): Record<string, unknown> {
  if (seen.has(value)) {
    return { circular: '[REDACTED]' };
  }
  seen.add(value);

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveKeyPattern.test(key) ? '[REDACTED]' : redactUnknown(entry, seen),
    ]),
  );
}

function redactUnknown(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return redactText(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return ['[REDACTED]'];
    }
    seen.add(value);
    return value.map((entry) => redactUnknown(entry, seen));
  }
  if (value !== null && typeof value === 'object') {
    return redactRecord(value as Record<string, unknown>, seen);
  }
  return value;
}

export function redactValue(value: unknown): unknown {
  return redactUnknown(value, new WeakSet());
}

export function redactText(value: string): string {
  return value
    .replace(privateKeyPattern, '[REDACTED]')
    .replace(jwtPattern, '[REDACTED]')
    .replace(vendorKeyPattern, '[REDACTED]')
    .replace(cookieHeaderPattern, '$1[REDACTED]')
    .replace(jsonOauthPattern, '$1[REDACTED]')
    .replace(bearerPattern, '$1[REDACTED]')
    .replace(authorizationSchemePattern, '$1[REDACTED]')
    .replace(urlUserinfoPattern, '$1[REDACTED]@')
    .replace(sensitiveQueryPattern, '$1[REDACTED]')
    .replace(sensitiveAssignmentPattern, '$1[REDACTED]');
}
