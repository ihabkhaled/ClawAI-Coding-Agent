import { backendErrorReason, gatewayErrorReason } from '../core/backend-error-body';
import { redactText } from '../core/redaction';

import { BackendRequestError } from './backend-errors';
import {
  MAX_ERROR_BODY_BYTES,
  MAX_SUCCESS_BODY_BYTES,
  UNREADABLE_RESPONSE_MESSAGE,
} from './backend-response.constants';
import {
  readBoundedResponseText,
  ResponseBodyLimitError,
  type ResponseLease,
} from './response-lease';

import type { z } from 'zod';

async function readResponseBody(lease: ResponseLease, limitBytes: number): Promise<string> {
  try {
    return await readBoundedResponseText(lease, limitBytes);
  } catch (error: unknown) {
    lease.callerSignal?.throwIfAborted();
    if (error instanceof ResponseBodyLimitError) {
      throw new BackendRequestError(error.message, lease.response.status, false);
    }
    const message = error instanceof Error ? redactText(error.message) : 'Backend response failed.';
    throw new BackendRequestError(message, 0, true);
  }
}

/** Turn a non-OK backend response into a redacted, readable `BackendRequestError`. */
export async function throwBackendResponseError(lease: ResponseLease): Promise<never> {
  const body = await readResponseBody(lease, MAX_ERROR_BODY_BYTES);
  const safeBody = redactText(body).trim();
  const statusMessage = `ClawAI request failed (${String(lease.response.status)}).`;
  // A platform error carries its own reason and code; showing the raw JSON
  // envelope around them made every backend failure unreadable in the panel.
  const reason =
    backendErrorReason(safeBody) ?? gatewayErrorReason(lease.response.status, safeBody);
  throw new BackendRequestError(
    reason ?? (safeBody.length === 0 ? statusMessage : `${statusMessage} ${safeBody}`),
    lease.response.status,
    lease.response.status === 408 || lease.response.status === 429 || lease.response.status >= 500,
  );
}

/** Read a bounded backend response and validate it against `schema`. */
export async function parseBackendResponse<T>(
  lease: ResponseLease,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!lease.response.ok) {
    await throwBackendResponseError(lease);
  }
  if (lease.response.status === 204) {
    lease.release();
    return schema.parse(undefined);
  }
  const text = await readResponseBody(lease, MAX_SUCCESS_BODY_BYTES);
  return parseJsonBody(text, schema, lease.response.status);
}

/**
 * Malformed JSON and a body of the wrong shape both end as one plain error.
 * The raw `SyntaxError` and `ZodError` messages quote the body back, which is
 * unreadable in the panel and can echo whatever a proxy put in that body.
 */
function parseJsonBody<T>(text: string, schema: z.ZodType<T>, status: number): T {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new BackendRequestError(UNREADABLE_RESPONSE_MESSAGE, status, false);
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new BackendRequestError(UNREADABLE_RESPONSE_MESSAGE, status, false);
  return result.data;
}
