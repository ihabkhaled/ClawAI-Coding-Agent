import {
  BackendRequestError,
  BackendSessionChangedError,
  BackendSessionExpiredError,
} from '../backend/backend-errors';
import {
  runtimeProtocolFallback,
  selectRuntimeProtocol,
  type RuntimeProtocolSelection,
  type RuntimeProtocolWireDescriptor,
} from '../core/runtime/runtime-negotiation';

interface RuntimeProtocolBackend {
  getRuntimeProtocol(signal?: AbortSignal): Promise<RuntimeProtocolWireDescriptor>;
}

export class RuntimeProtocolService {
  constructor(private readonly backend: () => RuntimeProtocolBackend) {}

  async negotiate(signal?: AbortSignal): Promise<RuntimeProtocolSelection> {
    try {
      return selectRuntimeProtocol(await this.backend().getRuntimeProtocol(signal));
    } catch (error: unknown) {
      signal?.throwIfAborted();
      if (
        error instanceof BackendSessionChangedError ||
        error instanceof BackendSessionExpiredError ||
        (error instanceof BackendRequestError && (error.status === 401 || error.status === 403))
      ) {
        throw error;
      }
      if (error instanceof BackendRequestError) {
        return runtimeProtocolFallback('endpoint-unavailable');
      }
      return runtimeProtocolFallback('malformed-descriptor');
    }
  }
}
