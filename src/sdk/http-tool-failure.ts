import { redactText } from '../core/redaction';

import type { HttpFailure, HttpFailureCode } from './http-tool.types';

/** A failure on the wire that already knows what it is. */
export class HttpTransportError extends Error {
  constructor(
    readonly code: HttpFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'HttpTransportError';
  }
}

const TLS_CODES =
  /^(?:CERT_|DEPTH_ZERO_SELF_SIGNED|SELF_SIGNED|UNABLE_TO_|ERR_TLS_|HOSTNAME_MISMATCH|EPROTO)/u;

const TLS_HELP =
  'The certificate could not be verified. Verification stays on: trust the CA with NODE_EXTRA_CA_CERTS=<ca.pem> or run node with --use-system-ca.';

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
}

/** What a failed attempt means to the model, with no secret in it. */
export function describeFailure(
  error: unknown,
  state: { readonly timedOut: boolean; readonly timeoutMs: number; readonly cancelled: boolean },
): HttpFailure {
  if (state.cancelled) return { code: 'CANCELLED', message: 'The run was cancelled.' };
  if (state.timedOut) {
    return {
      code: 'TIMEOUT',
      message: `No complete response within ${String(state.timeoutMs)} ms.`,
    };
  }
  if (error instanceof HttpTransportError) return { code: error.code, message: error.message };
  const code = errorCode(error);
  if (TLS_CODES.test(code))
    return { code: 'TLS_VERIFICATION_FAILED', message: `${code}: ${TLS_HELP}` };
  if (code === 'ECONNREFUSED') {
    return {
      code: 'CONNECTION_REFUSED',
      message: 'The connection was refused: nothing is listening there.',
    };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { code: 'DNS_FAILED', message: 'The host name did not resolve.' };
  }
  const detail = error instanceof Error ? error.message : 'unknown error';
  return {
    code: 'CONNECTION_FAILED',
    message: redactText(`${code} ${detail}`.trim()).slice(0, 300),
  };
}
