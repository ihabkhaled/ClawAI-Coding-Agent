import * as vscode from 'vscode';

import { type BackendClient } from '../backend/backend-client';
import { LoopbackAuthorizationServer } from '../core/loopback-authorization';
import { createVscodeAuthorizationRequest } from '../core/vscode-authorization';

import type { AuthUser } from '../backend/contracts';
import type { TokenPair } from '../core/session-vault';

export interface AuthorizationCallback {
  readonly callbackUri: string;
  dispose(): void;
  waitForCallback(): Promise<string>;
}

export interface AuthorizationCallbackFactory {
  open(state: string): Promise<AuthorizationCallback>;
}

interface AuthorizationAttempt {
  callback: AuthorizationCallback | null;
  controller: AbortController;
  disposed: boolean;
  rejectTermination: (error: Error) => void;
  termination: Promise<never>;
  terminationError: Error | null;
  timeout: NodeJS.Timeout | undefined;
}

export interface AuthorizedSession {
  tokens: TokenPair;
  user: AuthUser;
}

export class AuthorizationCancelledError extends Error {
  constructor() {
    super('ClawAI authorization was cancelled.');
    this.name = 'AuthorizationCancelledError';
  }
}

const AUTHORIZATION_TIMEOUT_MS = 2 * 60 * 1_000;

const defaultCallbackFactory: AuthorizationCallbackFactory = {
  open: (state) => LoopbackAuthorizationServer.open(state),
};

export class BrowserAuthorizationService implements vscode.Disposable {
  private attempt: AuthorizationAttempt | null = null;
  private signInPromise: Promise<AuthorizedSession> | null = null;

  constructor(
    private backend: BackendClient,
    private readonly callbackFactory: AuthorizationCallbackFactory = defaultCallbackFactory,
    private readonly authorizationTimeoutMs = AUTHORIZATION_TIMEOUT_MS,
  ) {}

  setBackend(backend: BackendClient): void {
    this.backend = backend;
  }

  signIn(backend: BackendClient = this.backend): Promise<AuthorizedSession> {
    if (this.signInPromise !== null) {
      return this.signInPromise;
    }
    let rejectTermination: (error: Error) => void = () => undefined;
    const termination = new Promise<never>((_resolve, reject) => {
      rejectTermination = reject;
    });
    const attempt: AuthorizationAttempt = {
      callback: null,
      controller: new AbortController(),
      disposed: false,
      rejectTermination,
      termination,
      terminationError: null,
      timeout: undefined,
    };
    this.attempt = attempt;
    const promise = Promise.race([
      this.performSignIn(backend, attempt),
      attempt.termination,
    ]).finally(() => {
      this.clearAttemptTimeout(attempt);
      this.disposeCallback(attempt);
      if (this.attempt === attempt) {
        this.attempt = null;
        this.signInPromise = null;
      }
    });
    attempt.timeout = setTimeout(() => {
      this.terminateAttempt(
        attempt,
        new Error(vscode.l10n.t('ClawAI authorization timed out. Please try again.')),
      );
    }, this.authorizationTimeoutMs);
    attempt.timeout.unref();
    this.signInPromise = promise;
    return promise;
  }

  cancel(): boolean {
    const attempt = this.attempt;
    if (attempt === null) {
      return false;
    }
    return this.terminateAttempt(attempt, new AuthorizationCancelledError());
  }

  dispose(): void {
    this.cancel();
  }

  private terminateAttempt(attempt: AuthorizationAttempt, error: Error): boolean {
    if (attempt.terminationError !== null) {
      return false;
    }
    attempt.terminationError = error;
    attempt.controller.abort(error);
    this.disposeCallback(attempt);
    attempt.rejectTermination(error);
    return true;
  }

  private clearAttemptTimeout(attempt: AuthorizationAttempt): void {
    if (attempt.timeout === undefined) {
      return;
    }
    clearTimeout(attempt.timeout);
    attempt.timeout = undefined;
  }

  private async performSignIn(
    backend: BackendClient,
    attempt: AuthorizationAttempt,
  ): Promise<AuthorizedSession> {
    const request = createVscodeAuthorizationRequest();
    const callback = await this.callbackFactory.open(request.state);
    attempt.callback = callback;
    try {
      this.throwIfTerminated(attempt);
      const initialized = await backend.initializeVscodeAuthorization(
        {
          callbackUri: callback.callbackUri,
          codeChallenge: request.codeChallenge,
          state: request.state,
        },
        attempt.controller.signal,
      );
      this.throwIfTerminated(attempt);
      const codePromise = callback.waitForCallback();
      const opened = vscode.env.openExternal(
        vscode.Uri.parse(backend.authorizationUrl(initialized.authorizationPath)),
      );
      const code = await Promise.race([
        codePromise,
        opened.then((didOpen) => {
          if (!didOpen) {
            throw new Error('VS Code could not open the ClawAI authorization page.');
          }
          return codePromise;
        }),
      ]);
      this.throwIfTerminated(attempt);
      const tokens = await backend.exchangeVscodeAuthorization(
        code,
        request.codeVerifier,
        attempt.controller.signal,
      );
      this.throwIfTerminated(attempt);
      const user = await backend.getProfileWithAccessToken(
        tokens.accessToken,
        attempt.controller.signal,
      );
      this.throwIfTerminated(attempt);
      return { tokens, user };
    } catch (error: unknown) {
      this.throwIfTerminated(attempt);
      throw error;
    } finally {
      this.disposeCallback(attempt);
    }
  }

  private throwIfTerminated(attempt: AuthorizationAttempt): void {
    if (attempt.terminationError !== null) {
      throw attempt.terminationError;
    }
  }

  private disposeCallback(attempt: AuthorizationAttempt): void {
    if (attempt.callback === null || attempt.disposed) {
      return;
    }
    attempt.disposed = true;
    attempt.callback.dispose();
  }
}
