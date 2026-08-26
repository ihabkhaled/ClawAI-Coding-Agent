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

/**
 * Bind this client to the session it is going to use, or refuse to.
 *
 * One session is shared per backend origin across every window, so a window can
 * legitimately find a sessionId it has never seen: the same user signed in
 * again somewhere else, and that rotation is the shared vault working as
 * designed. This used to throw on any change, which meant opening a second
 * window silently logged the first one out and left it on the Connect gate with
 * a queued message lost.
 *
 * A takeover by a DIFFERENT account still has to refuse — continuing would run
 * one person's agent against another person's entitlements. So the account, not
 * the session id, is what decides. When either side has no account recorded the
 * old strict behaviour stands: a legacy record proves nothing about who owns it
 * and must not be adopted on faith.
 */
export function bindBackendSession(
  current: string | null,
  incoming: string,
  accounts?: { current?: string | undefined; incoming?: string | undefined },
): string {
  if (current === null || current === incoming) return incoming;
  const boundAccount = accounts?.current;
  const incomingAccount = accounts?.incoming;
  const sameAccount =
    boundAccount !== undefined && incomingAccount !== undefined && boundAccount === incomingAccount;
  if (!sameAccount) throw new BackendSessionChangedError();
  return incoming;
}
import { redactText } from '../core/redaction';
