import { describe, expect, it } from 'vitest';

import { backendErrorReason } from '../../src/core/backend-error-body';

describe('backendErrorReason', () => {
  it('extracts the reason and code from a platform error envelope', () => {
    // The panel showed this whole envelope verbatim, so a run that ended
    // because the provider returned nothing read as a wall of JSON.
    const body = JSON.stringify({
      statusCode: 400,
      message: 'Cloud provider OLLAMA returned no message content',
      timestamp: '2026-08-06T17:57:01.922Z',
      code: 'CLOUD_PROVIDER_EMPTY_RESPONSE',
    });

    expect(backendErrorReason(body)).toBe(
      'Cloud provider OLLAMA returned no message content (CLOUD_PROVIDER_EMPTY_RESPONSE)',
    );
  });

  it('uses the message alone when there is no code', () => {
    expect(backendErrorReason('{"statusCode":409,"message":"That run already finished"}')).toBe(
      'That run already finished',
    );
  });

  it('leaves anything that is not a platform envelope to the caller', () => {
    expect(backendErrorReason('Bad Gateway')).toBeUndefined();
    expect(backendErrorReason('{ not json')).toBeUndefined();
    expect(backendErrorReason('{"statusCode":500}')).toBeUndefined();
    expect(backendErrorReason('{"message":"   "}')).toBeUndefined();
    expect(backendErrorReason('[]')).toBeUndefined();
    expect(backendErrorReason('')).toBeUndefined();
  });
});
