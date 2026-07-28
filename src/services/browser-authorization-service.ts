import * as vscode from 'vscode';

import { type BackendClient } from '../backend/backend-client';
import { LoopbackAuthorizationServer } from '../core/loopback-authorization';
import { createVscodeAuthorizationRequest } from '../core/vscode-authorization';

import type { AuthUser } from '../backend/contracts';

export interface AuthorizationCallback {
  readonly callbackUri: string;
  dispose(): void;
  waitForCallback(): Promise<string>;
}

export interface AuthorizationCallbackFactory {
  open(state: string): Promise<AuthorizationCallback>;
}

const defaultCallbackFactory: AuthorizationCallbackFactory = {
  open: (state) => LoopbackAuthorizationServer.open(state),
};

export class BrowserAuthorizationService implements vscode.Disposable {
  private callback: AuthorizationCallback | null = null;

  constructor(
    private backend: BackendClient,
    private readonly callbackFactory: AuthorizationCallbackFactory = defaultCallbackFactory,
  ) {}

  setBackend(backend: BackendClient): void {
    this.backend = backend;
  }

  async signIn(): Promise<AuthUser> {
    if (this.callback !== null) {
      throw new Error('A ClawAI browser authorization is already in progress.');
    }
    const request = createVscodeAuthorizationRequest();
    const callback = await this.callbackFactory.open(request.state);
    this.callback = callback;
    try {
      const initialized = await this.backend.initializeVscodeAuthorization({
        callbackUri: callback.callbackUri,
        codeChallenge: request.codeChallenge,
        state: request.state,
      });
      const codePromise = callback.waitForCallback();
      const opened = vscode.env.openExternal(
        vscode.Uri.parse(this.backend.authorizationUrl(initialized.authorizationPath)),
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
      await this.backend.exchangeVscodeAuthorization(code, request.codeVerifier);
      return await this.backend.getProfile();
    } finally {
      callback.dispose();
      this.callback = null;
    }
  }

  dispose(): void {
    this.callback?.dispose();
    this.callback = null;
  }
}
