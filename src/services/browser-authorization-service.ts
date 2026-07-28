import * as vscode from 'vscode';

import { type BackendClient } from '../backend/backend-client';
import {
  createVscodeAuthorizationRequest,
  parseVscodeAuthorizationCallback,
} from '../core/vscode-authorization';

import type { AuthUser } from '../backend/contracts';

interface PendingAuthorization {
  reject: (error: Error) => void;
  resolve: (code: string) => void;
  state: string;
  timer: NodeJS.Timeout;
}

const AUTHORIZATION_TIMEOUT_MS = 10 * 60 * 1_000;

export class BrowserAuthorizationService implements vscode.Disposable, vscode.UriHandler {
  private pending: PendingAuthorization | null = null;

  constructor(private backend: BackendClient) {}

  setBackend(backend: BackendClient): void {
    this.backend = backend;
  }

  async signIn(): Promise<AuthUser> {
    if (this.pending !== null) {
      throw new Error('A ClawAI browser authorization is already in progress.');
    }
    const request = createVscodeAuthorizationRequest();
    const callbackUri = `${vscode.env.uriScheme}://clawai.clawai-coding-agent/auth/callback`;
    const initialized = await this.backend.initializeVscodeAuthorization({
      callbackUri,
      codeChallenge: request.codeChallenge,
      state: request.state,
    });
    const callback = this.waitForCallback(request.state);
    try {
      const opened = await vscode.env.openExternal(
        vscode.Uri.parse(this.backend.authorizationUrl(initialized.authorizationPath)),
      );
      if (!opened) {
        throw new Error('VS Code could not open the ClawAI authorization page.');
      }
    } catch (error: unknown) {
      const failure =
        error instanceof Error
          ? error
          : new Error('VS Code could not open the ClawAI authorization page.');
      this.takePending()?.reject(failure);
      await callback.catch(() => undefined);
      throw failure;
    }
    const code = await callback;
    await this.backend.exchangeVscodeAuthorization(code, request.codeVerifier);
    return this.backend.getProfile();
  }

  handleUri(uri: vscode.Uri): void {
    if (this.pending === null) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t('No ClawAI authorization request is waiting for this callback.'),
      );
      return;
    }
    try {
      const callback = parseVscodeAuthorizationCallback(new URL(uri.toString(true)));
      if (callback.state !== this.pending.state) {
        throw new Error('ClawAI authorization state did not match. Please try again.');
      }
      const pending = this.takePending();
      pending?.resolve(callback.code);
    } catch (error: unknown) {
      const pending = this.takePending();
      pending?.reject(
        error instanceof Error ? error : new Error('ClawAI authorization callback failed.'),
      );
    }
  }

  dispose(): void {
    const pending = this.takePending();
    pending?.reject(new Error('ClawAI authorization was cancelled.'));
  }

  private waitForCallback(state: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.takePending();
        pending?.reject(new Error('ClawAI authorization timed out. Please try again.'));
      }, AUTHORIZATION_TIMEOUT_MS);
      this.pending = { reject, resolve, state, timer };
    });
  }

  private takePending(): PendingAuthorization | null {
    const pending = this.pending;
    if (pending !== null) {
      clearTimeout(pending.timer);
      this.pending = null;
    }
    return pending;
  }
}
