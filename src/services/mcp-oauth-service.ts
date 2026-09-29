import {
  authorizationCodeBody,
  authorizationMetadataUrl,
  buildAuthorizationUrl,
  isTokenFresh,
  needsDiscovery,
  parseTokenResponse,
  refreshTokenBody,
  resolveAuthorizationEndpoints,
  storedTokenSetSchema,
  tokenSecretKey,
} from '../core/mcp/mcp-oauth';
import { MCP_OAUTH_TIMEOUT_MS } from '../core/mcp/mcp.constants';
import { createVscodeAuthorizationRequest } from '../core/vscode-authorization';

import type { McpOAuthDependencies } from './mcp-oauth-service.types';
import type { McpHttpServerConfig, McpOAuthConfig, McpTokenSet } from '../core/mcp/mcp.types';
import type { McpTokenProvider } from '../infrastructure/mcp/mcp-transport.types';

const EXCHANGE_TIMEOUT_MS = 30_000;

/**
 * OAuth 2.1 authorization code with PKCE for MCP servers that ask for it.
 *
 * The browser returns to a one-shot loopback listener on 127.0.0.1, the same
 * mechanism the ClawAI sign-in uses, never to the `vscode://` handler — see
 * docs/adr/0002-mcp-oauth-uses-the-loopback-callback.md. Tokens live only in
 * SecretStorage; nothing here logs or returns one except to the transport that
 * sends it.
 */
export class McpOAuthService {
  private readonly inFlight = new Map<string, Promise<string | undefined>>();

  constructor(private readonly deps: McpOAuthDependencies) {}

  tokenProvider(server: McpHttpServerConfig): McpTokenProvider {
    return {
      current: (signal) => this.current(server, signal),
      renew: (signal) => this.singleFlight(server, () => this.renew(server, signal)),
    };
  }

  async forget(server: McpHttpServerConfig): Promise<void> {
    await this.deps.secrets.delete(tokenSecretKey(server));
  }

  private async current(
    server: McpHttpServerConfig,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const stored = await this.read(server);
    if (stored === undefined) return undefined;
    if (isTokenFresh(stored, this.deps.now())) return stored.accessToken;
    if (stored.refreshToken === undefined || server.oauth === undefined) return undefined;
    return this.singleFlight(server, () => this.refreshOrUndefined(server, stored, signal));
  }

  private async renew(
    server: McpHttpServerConfig,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (server.oauth === undefined) return undefined;
    const stored = await this.read(server);
    if (stored?.refreshToken !== undefined) {
      const refreshed = await this.refreshOrUndefined(server, stored, signal);
      if (refreshed !== undefined) return refreshed;
    }
    return this.authorize(server, server.oauth, signal);
  }

  private async refreshOrUndefined(
    server: McpHttpServerConfig,
    stored: McpTokenSet,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const oauth = server.oauth;
    if (oauth === undefined || stored.refreshToken === undefined) return undefined;
    try {
      const endpoints = await this.endpoints(server, oauth, signal);
      const tokens = await this.exchange(
        endpoints.tokenEndpoint,
        refreshTokenBody(stored.refreshToken, server, oauth),
        stored.refreshToken,
        signal,
      );
      await this.write(server, tokens);
      return tokens.accessToken;
    } catch {
      // A refused refresh means the grant is gone; the caller falls back to a
      // fresh authorization, and the stale set is dropped so it is not retried.
      await this.forget(server);
      return undefined;
    }
  }

  private async authorize(
    server: McpHttpServerConfig,
    oauth: McpOAuthConfig,
    signal?: AbortSignal,
  ): Promise<string> {
    const endpoints = await this.endpoints(server, oauth, signal);
    const request = createVscodeAuthorizationRequest();
    const callback = await this.deps.callbacks.open(request.state);
    try {
      const url = buildAuthorizationUrl({
        endpoint: endpoints.authorizationEndpoint,
        server,
        oauth,
        redirectUri: callback.callbackUri,
        codeChallenge: request.codeChallenge,
        state: request.state,
      });
      if (!(await this.deps.openBrowser(url))) {
        throw new Error('VS Code could not open the MCP authorization page');
      }
      const code = await withDeadline(callback.waitForCallback(), MCP_OAUTH_TIMEOUT_MS, signal);
      const tokens = await this.exchange(
        endpoints.tokenEndpoint,
        authorizationCodeBody({
          code,
          codeVerifier: request.codeVerifier,
          redirectUri: callback.callbackUri,
          server,
          oauth,
        }),
        undefined,
        signal,
      );
      await this.write(server, tokens);
      callback.confirmAuthorization();
      return tokens.accessToken;
    } catch (error: unknown) {
      callback.rejectAuthorization();
      throw error;
    } finally {
      callback.dispose();
    }
  }

  private async endpoints(
    server: McpHttpServerConfig,
    oauth: McpOAuthConfig,
    signal?: AbortSignal,
  ): Promise<{ authorizationEndpoint: string; tokenEndpoint: string }> {
    if (!needsDiscovery(oauth)) return resolveAuthorizationEndpoints(oauth, undefined);
    const response = await this.deps.fetch(authorizationMetadataUrl(server.url), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: deadline(signal),
    });
    if (!response.ok) throw new Error('MCP authorization server metadata is unavailable');
    const metadata: unknown = await response.json();
    return resolveAuthorizationEndpoints(oauth, metadata);
  }

  private async exchange(
    tokenEndpoint: string,
    body: string,
    previousRefreshToken: string | undefined,
    signal?: AbortSignal,
  ): Promise<McpTokenSet> {
    const response = await this.deps.fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
      redirect: 'error',
      signal: deadline(signal),
    });
    // The body of a failed exchange is not read into the error: token
    // endpoints echo request parameters, and the request carried a secret.
    if (!response.ok) {
      throw new Error(`MCP token endpoint answered HTTP ${String(response.status)}`);
    }
    const payload: unknown = await response.json();
    return parseTokenResponse(payload, this.deps.now(), previousRefreshToken);
  }

  private async read(server: McpHttpServerConfig): Promise<McpTokenSet | undefined> {
    const raw = await this.deps.secrets.get(tokenSecretKey(server));
    if (raw === undefined) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      return storedTokenSetSchema.parse(parsed);
    } catch {
      return undefined;
    }
  }

  private async write(server: McpHttpServerConfig, tokens: McpTokenSet): Promise<void> {
    await this.deps.secrets.store(tokenSecretKey(server), JSON.stringify(tokens));
  }

  private singleFlight(
    server: McpHttpServerConfig,
    task: () => Promise<string | undefined>,
  ): Promise<string | undefined> {
    const key = tokenSecretKey(server);
    const existing = this.inFlight.get(key);
    if (existing !== undefined) return existing;
    const running = task().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, running);
    return running;
  }
}

function deadline(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(EXCHANGE_TIMEOUT_MS);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('MCP authorization timed out'));
    }, timeoutMs);
    timer.unref();
    const aborted = (): void => {
      reject(new Error('MCP authorization was cancelled'));
    };
    signal?.addEventListener('abort', aborted, { once: true });
    promise.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
    });
  });
}
