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
