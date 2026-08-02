import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError, BackendSessionExpiredError } from '../../src/backend/backend-errors';
import { RuntimeProtocolService } from '../../src/services/runtime-protocol-service';

const descriptor = {
  versions: ['2.0', '1.0'],
  preferred: '2.0',
  transports: ['sse'],
  features: {
    capabilityManifest: true,
    orderedRunEvents: true,
    toolExecution: false,
  },
  limits: { maxEventBytes: 1_048_576, maxActiveRuns: 8 },
};

describe('RuntimeProtocolService', () => {
  it('negotiates a valid descriptor', async () => {
    const backend = { getRuntimeProtocol: vi.fn(async () => descriptor) };

    await expect(new RuntimeProtocolService(() => backend).negotiate()).resolves.toMatchObject({
      mode: 'runtime-v2',
    });
  });

  it.each([
    [new BackendRequestError('not found', 404, false), 'endpoint-unavailable'],
    [new BackendRequestError('timeout', 0, true), 'endpoint-unavailable'],
    [new Error('invalid response'), 'malformed-descriptor'],
  ])('falls back safely when negotiation is additive and unavailable', async (error, reason) => {
    const backend = { getRuntimeProtocol: vi.fn(async () => Promise.reject(error)) };

    await expect(new RuntimeProtocolService(() => backend).negotiate()).resolves.toEqual({
      mode: 'legacy-v1',
      version: '1.0',
      reason,
    });
  });

  it('propagates session expiry instead of hiding it as V1 fallback', async () => {
    const backend = {
      getRuntimeProtocol: vi.fn(async () => Promise.reject(new BackendSessionExpiredError())),
    };

    await expect(new RuntimeProtocolService(() => backend).negotiate()).rejects.toBeInstanceOf(
      BackendSessionExpiredError,
    );
  });

  it('propagates caller cancellation without mutating protocol state', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    const backend = {
      getRuntimeProtocol: vi.fn(async (signal?: AbortSignal) => {
        signal?.throwIfAborted();
        return descriptor;
      }),
    };

    await expect(
      new RuntimeProtocolService(() => backend).negotiate(controller.signal),
    ).rejects.toThrow('cancelled');
  });
});
