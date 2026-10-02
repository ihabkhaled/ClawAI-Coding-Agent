/**
 * The reason inside a platform error body, or nothing when it is not one.
 *
 * The panel showed the whole HTTP envelope verbatim — a run that ended because
 * the provider returned no content read as
 * `ClawAI request failed (400). {"statusCode":400,"message":"Cloud provider
 * OLLAMA returned no message content","timestamp":"…","code":"…"}`. The reason
 * was in there, buried in JSON nobody should have to read.
 */
export function backendErrorReason(body: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object') {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message.trim() : '';
  if (message.length === 0) {
    return undefined;
  }
  const code = typeof record.code === 'string' ? record.code.trim() : '';
  return code.length === 0 ? message : `${message} (${code})`;
}

const GATEWAY_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/**
 * A short, readable reason for a gateway failure, or nothing for other errors.
 *
 * A 502 from the front proxy arrives as a page of HTML. Showing it verbatim put
 * `<html><head><title>502 Bad Gateway</title>` in the sign-in panel, when the
 * whole story is that a ClawAI service behind the proxy was starting, restarting
 * or down and a retry in a moment will usually work.
 */
export function gatewayErrorReason(status: number, body: string): string | undefined {
  if (!GATEWAY_STATUSES.has(status)) return undefined;
  const trimmed = body.trim();
  if (trimmed.length > 0 && !trimmed.startsWith('<')) return undefined;
  return `ClawAI is temporarily unavailable (${String(status)}): a service behind the server is starting, restarting or stopped. Try again in a moment.`;
}
