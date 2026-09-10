const sensitiveKeyPattern =
  /(?:access.?token|refresh.?token|authorization|cookie|password|passphrase|secret|api.?key|client.?secret|credential|token)/iu;
const bearerPattern = /(\bBearer\s+)[A-Za-z0-9._~+/=-]+/giu;
const sensitiveQueryPattern =
  /([?&](?:access_token|refresh_token|token|api_key|apikey|key|secret|password)=)[^&\s]+/giu;

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
    .replace(bearerPattern, '$1[REDACTED]')
    .replace(sensitiveQueryPattern, '$1[REDACTED]')
    .replace(sensitiveAssignmentPattern, '$1[REDACTED]');
}
