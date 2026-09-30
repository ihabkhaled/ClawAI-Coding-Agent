import {
  TELEMETRY_HEADER_NAME_PATTERN,
  TELEMETRY_HEADER_VALUE_MAX_LENGTH,
  TELEMETRY_HEADERS_MAX_ENTRIES,
} from './telemetry-headers.constants';

function validEntry(name: string, value: unknown): value is string {
  return (
    TELEMETRY_HEADER_NAME_PATTERN.test(name) &&
    typeof value === 'string' &&
    value.length <= TELEMETRY_HEADER_VALUE_MAX_LENGTH &&
    !/[\r\n\0]/u.test(value)
  );
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The headers from an untrusted value, or `undefined` when any entry is unusable.
 *
 * All or nothing: dropping one bad entry from `{"authorization": …}` would send
 * the rest without the credential and turn a typo into a stream of 401s that
 * nobody connects to the paste.
 */
export function telemetryHeadersFrom(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > TELEMETRY_HEADERS_MAX_ENTRIES) return undefined;
  const headers: Record<string, string> = {};
  for (const [name, entry] of entries) {
    if (!validEntry(name, entry)) return undefined;
    headers[name] = entry;
  }
  return headers;
}

/** Headers typed as JSON text, or `undefined` when the text is not a usable object. */
export function parseTelemetryHeadersText(text: string): Record<string, string> | undefined {
  try {
    return telemetryHeadersFrom(JSON.parse(text));
  } catch {
    return undefined;
  }
}
