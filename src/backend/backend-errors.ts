export class BackendRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'BackendRequestError';
  }
}

export class BackendSessionChangedError extends BackendRequestError {
  constructor() {
    super(
      'The ClawAI account changed in another VS Code window. Reconnect to continue.',
      401,
      false,
    );
    this.name = 'BackendSessionChangedError';
  }
}

export class BackendSessionExpiredError extends BackendRequestError {
  constructor() {
    super('Your ClawAI session expired. Reconnect to continue.', 401, false);
    this.name = 'BackendSessionExpiredError';
  }
}

export function isBackendSessionBoundaryError(
  error: unknown,
): error is BackendSessionChangedError | BackendSessionExpiredError {
  return error instanceof BackendSessionChangedError || error instanceof BackendSessionExpiredError;
}

export function backendTransportFailureMessage(error: unknown, timedOut: boolean): string {
  if (!timedOut)
    return 'ClawAI backend is unavailable. Check the app address or start the services, then retry.';
  return error instanceof Error ? redactText(error.message) : 'ClawAI request timed out.';
}

export function bindBackendSession(current: string | null, incoming: string): string {
  if (current !== null && current !== incoming) throw new BackendSessionChangedError();
  return incoming;
}
import { redactText } from '../core/redaction';
