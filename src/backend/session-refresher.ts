import { BackendSessionExpiredError } from './backend-errors';
import { waitForCaller } from './response-lease';

/**
 * The one place a session rotation is started, shared, and given up on.
 *
 * Two rules make a silent refresh safe. Concurrency: every caller that notices
 * a stale or rejected token joins the rotation already running instead of
 * starting its own, because the backend burns a refresh token on first use and
 * a second concurrent rotation replays a consumed token, which the backend
 * treats as theft and answers by revoking the whole token family. Finality:
 * once the backend has genuinely rejected the refresh token, no further attempt
 * is made — the extension falls back to browser sign-in exactly once instead of
 * hammering `/auth/refresh` behind every request.
 */
export class SessionRefresher {
  private controller: AbortController | null = null;
  private inFlight: Promise<void> | null = null;
  private terminal: BackendSessionExpiredError | null = null;

  constructor(private readonly perform: (signal: AbortSignal) => Promise<void>) {}

  /** Whether the refresh token itself was rejected and sign-in is the only way back. */
  isTerminated(): boolean {
    return this.terminal !== null;
  }

  /**
   * Record that the refresh token is dead and return the error to throw.
   *
   * The same error instance is reused so every caller waiting on the shared
   * rotation, and every later caller, sees one terminal outcome.
   */
  terminate(): BackendSessionExpiredError {
    this.terminal ??= new BackendSessionExpiredError();
    return this.terminal;
  }

  /** Abandon a rotation in flight, used when the session ends underneath it. */
  abort(reason: Error): void {
    this.controller?.abort(reason);
  }

  /**
   * Rotate the session, joining the attempt already running when there is one.
   *
   * The caller's signal only detaches that caller: the rotation keeps running
   * for everyone else, so one cancelled request cannot strand the others with a
   * consumed refresh token.
   */
  run(signal?: AbortSignal): Promise<void> {
    if (this.terminal !== null) {
      return Promise.reject(this.terminal);
    }
    return waitForCaller(this.start(), signal);
  }

  private start(): Promise<void> {
    const existing = this.inFlight;
    if (existing !== null) {
      return existing;
    }
    const controller = new AbortController();
    const started = this.perform(controller.signal);
    this.inFlight = started;
    this.controller = controller;
    void started.then(
      () => {
        this.settle(started, controller);
      },
      () => {
        this.settle(started, controller);
      },
    );
    return started;
  }

  private settle(promise: Promise<void>, controller: AbortController): void {
    if (this.inFlight === promise) {
      this.inFlight = null;
    }
    if (this.controller === controller) {
      this.controller = null;
    }
  }
}
