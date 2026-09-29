import {
  OTLP_MAX_ATTEMPTS,
  OTLP_RETRY_BASE_MS,
  OTLP_RETRYABLE_STATUSES,
  OTLP_TIMEOUT_MS,
} from '../core/otlp-export.constants';

import type { OutputLogger } from './output-logger';
import type { OtlpEndpoint } from '../core/otlp-export.types';

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Posts one OTLP/HTTP JSON body, retrying what the specification says to retry.
 *
 * Never throws: a collector being down must not turn into a failed run. The
 * log line carries the status and never the response body, because a
 * collector's error body can echo the request and the request carries the
 * headers.
 */
export async function postOtlp(
  send: typeof fetch,
  endpoint: OtlpEndpoint,
  url: string,
  body: string,
  logger: OutputLogger,
  sleep: (milliseconds: number) => Promise<void> = wait,
): Promise<boolean> {
  for (let attempt = 1; attempt <= OTLP_MAX_ATTEMPTS; attempt += 1) {
    const retryable = await postOnce(send, endpoint, url, body, logger);
    if (retryable === undefined) return true;
    if (!retryable || attempt === OTLP_MAX_ATTEMPTS) return false;
    await sleep(OTLP_RETRY_BASE_MS * 2 ** (attempt - 1));
  }
  return false;
}

/** Nothing on success; otherwise whether this failure is worth another try. */
async function postOnce(
  send: typeof fetch,
  endpoint: OtlpEndpoint,
  url: string,
  body: string,
  logger: OutputLogger,
): Promise<boolean | undefined> {
  try {
    const response = await send(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...endpoint.headers },
      body,
      signal: AbortSignal.timeout(OTLP_TIMEOUT_MS),
    });
    if (response.ok) return undefined;
    logger.warn('ClawAI telemetry export was refused.', { status: response.status });
    return OTLP_RETRYABLE_STATUSES.has(response.status);
  } catch (error: unknown) {
    logger.warn('ClawAI telemetry export failed.', error);
    return true;
  }
}
