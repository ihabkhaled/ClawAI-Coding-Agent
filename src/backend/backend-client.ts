import { z } from 'zod';

import { accessTokenNeedsRefresh } from '../core/access-token-expiry';
import { ACCESS_TOKEN_REFRESH_SKEW_MS } from '../core/access-token-expiry.constants';
import { backendErrorReason } from '../core/backend-error-body';
import { joinApiUrl, normalizeBackendUrl } from '../core/configuration';
import { redactText } from '../core/redaction';
import { type SessionVault, type TokenPair } from '../core/session-vault';

import {
  BackendRequestError,
  BackendSessionChangedError,
  backendTransportFailureMessage,
  bindBackendSession,
  isBackendSessionBoundaryError,
} from './backend-errors';
import { BackendRuntimeClient } from './backend-runtime-client';
import {
  connectorModelSchema,
  entitlementsSchema,
  localFrontierListSchema,
  localOllamaModelSchema,
  messageSchema,
  paginatedSchema,
  parallelResponseSchema,
  refreshResultSchema,
  routerModelSchema,
  threadSchema,
  usageSchema,
  userProfileSchema,
  vscodeAuthorizationInitResultSchema,
  uploadedFileSchema,
  type ChatMessage,
  type ChatThread,
  type ConnectorModel,
  type Entitlements,
  type LocalFrontierModel,
  type LocalOllamaModel,
  type ParallelResponse,
  type RouterModel,
  type Usage,
  type UploadedFile,
} from './contracts';
import {
  discardResponseBody,
  readBoundedResponseText,
  ResponseBodyLimitError,
  responseWithIdleTimeout,
  type ResponseLease,
} from './response-lease';
import { SessionRefresher } from './session-refresher';

import type {
  BackendClientOptions,
  CompareRequest,
  MessageRequest,
  RuntimeCommandBinding,
  RuntimeMutationAck,
  RuntimeStartAck,
  RuntimeStartRequest,
} from './backend-client.types';
import type { ChatAttachment } from '../core/chat-attachment';
import type { ToolResult } from '../core/runtime/runtime-tool-contracts';
export {
  BackendRequestError,
  BackendSessionChangedError,
  BackendSessionExpiredError,
} from './backend-errors';

const MAX_ERROR_BODY_BYTES = 64_000;
const MAX_SUCCESS_BODY_BYTES = 8_000_000;

export class BackendClient {
  private readonly backendUrl: string;
  private readonly clientName: string;
  private readonly fetcher: typeof fetch;
  private readonly sessionVault: SessionVault;
  private readonly timeoutMs: number;
  private readonly runtime: BackendRuntimeClient;
  private readonly refresher = new SessionRefresher((signal) => this.performRefresh(signal));
  private boundSessionId: string | null = null;
  // Which account the bound session belongs to. Set the first time this client
  // binds and used to tell the same user re-authorizing in another window from
  // a different account taking over the shared session slot.
  private boundAccountId: string | undefined = undefined;

  constructor(options: BackendClientOptions) {
    this.backendUrl = normalizeBackendUrl(options.backendUrl);
    this.clientName = options.clientName ?? 'ClawAI for VS Code';
    this.fetcher = options.fetcher ?? fetch;
    this.sessionVault = options.sessionVault;
    this.timeoutMs = options.timeoutMs;
    this.runtime = new BackendRuntimeClient(
      (path, schema, requestOptions) => this.request(path, schema, requestOptions),
      (path, signal) => this.openAuthenticatedStream(path, signal),
    );
  }

  async initializeVscodeAuthorization(
    input: {
      callbackUri: string;
      state: string;
      codeChallenge: string;
    },
    signal?: AbortSignal,
  ): Promise<z.infer<typeof vscodeAuthorizationInitResultSchema>> {
    const response = await this.send('/auth/vscode/authorize/init', {
      auth: false,
      body: {
        ...input,
        clientName: this.clientName,
      },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    });
    return this.parse(response, vscodeAuthorizationInitResultSchema);
  }

  async exchangeVscodeAuthorization(
    code: string,
    codeVerifier: string,
    signal?: AbortSignal,
  ): Promise<TokenPair> {
    const response = await this.send('/auth/vscode/authorize/exchange', {
      auth: false,
      body: { code, codeVerifier },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    });
    const result = await this.parse(response, refreshResultSchema);
    return result.tokens;
  }

  /** Bind to a session from the shared vault, adopting a same-account rotation. */
  private bindSession(session: { accountId?: string; sessionId: string }): void {
    this.boundSessionId = bindBackendSession(this.boundSessionId, session.sessionId, {
      current: this.boundAccountId,
      incoming: session.accountId,
    });
    this.boundAccountId = session.accountId ?? this.boundAccountId;
  }

  async logout(): Promise<void> {
    this.refresher.abort(new Error('ClawAI session ended.'));
    const current = await this.sessionVault.loadBound(this.backendUrl);
    if (current === null) {
      return;
    }
    this.bindSession(current);
    const tokens = await this.sessionVault.clearIfSession(this.backendUrl, current.sessionId);
    if (tokens === null) {
      throw new BackendSessionChangedError();
    }
    const response = await this.send('/auth/logout', {
      accessToken: tokens.accessToken,
      auth: false,
      method: 'POST',
    });
    if (!response.response.ok && response.response.status !== 401) {
      await this.throwResponseError(response);
      return;
    }
    await discardResponseBody(response);
  }

  async getProfile(): Promise<z.infer<typeof userProfileSchema>> {
    return this.request('/auth/me', userProfileSchema);
  }

  async getProfileWithAccessToken(
    accessToken: string,
    signal?: AbortSignal,
  ): Promise<z.infer<typeof userProfileSchema>> {
    const response = await this.send('/auth/me', {
      accessToken,
      auth: false,
      method: 'GET',
      ...(signal === undefined ? {} : { signal }),
    });
    return this.parse(response, userProfileSchema);
  }

  async getEntitlements(): Promise<Entitlements> {
    return this.request('/auth/me/entitlements', entitlementsSchema);
  }

  async getUsage(): Promise<Usage> {
    return this.request('/auth/me/usage', usageSchema);
  }

  getRuntimeProtocol(signal?: AbortSignal) {
    return this.runtime.getProtocol(signal);
  }

  async startRuntime(input: RuntimeStartRequest, signal?: AbortSignal): Promise<RuntimeStartAck> {
    return this.runtime.start(input, signal);
  }

  async submitRuntimeResult(
    binding: RuntimeCommandBinding,
    idempotencyKey: string,
    result: ToolResult,
    signal?: AbortSignal,
  ): Promise<RuntimeMutationAck> {
    return this.runtime.submitResult(binding, idempotencyKey, result, signal);
  }

  async steerRuntime(
    binding: RuntimeCommandBinding,
    steering: unknown,
    signal?: AbortSignal,
  ): Promise<RuntimeMutationAck> {
    return this.runtime.steer(binding, steering, signal);
  }

  async cancelRuntime(
    binding: RuntimeCommandBinding,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<RuntimeMutationAck> {
    return this.runtime.cancel(binding, idempotencyKey, signal);
  }

  async openRuntimeStream(
    binding: RuntimeCommandBinding,
    after: number,
    signal?: AbortSignal,
  ): Promise<Response> {
    return this.runtime.openStream(binding, after, signal);
  }

  async getRouterModels(): Promise<RouterModel[]> {
    const result = await this.request(
      '/routing/models?limit=200&isExecutionCapable=true',
      paginatedSchema(routerModelSchema),
    );
    return result.data;
  }

  async getConnectorModels(): Promise<ConnectorModel[]> {
    return this.request('/connectors/available-models', z.array(connectorModelSchema));
  }

  async getLocalOllamaModels(): Promise<LocalOllamaModel[]> {
    const result = await this.request(
      '/ollama/models?limit=100&runtime=OLLAMA&isInstalled=true',
      paginatedSchema(localOllamaModelSchema),
    );
    return result.data;
  }

  async getLocalFrontierModels(): Promise<LocalFrontierModel[]> {
    const result = await this.request('/llamacpp/catalog?limit=100', localFrontierListSchema);
    return result.data;
  }

  authorizationUrl(path: string): string {
    return `${this.backendUrl}${path}`;
  }

  async createThread(input: {
    title?: string;
    routingMode: 'AUTO' | 'MANUAL_MODEL';
    preferredProvider?: string;
    preferredModel?: string;
  }): Promise<ChatThread> {
    return this.request('/chat-threads', threadSchema, {
      body: input,
      method: 'POST',
    });
  }

  async listThreads(limit = 50): Promise<ChatThread[]> {
    const result = await this.request(
      `/chat-threads?limit=${String(limit)}`,
      paginatedSchema(threadSchema),
    );
    return result.data;
  }

  async listMessages(threadId: string, limit = 100): Promise<ChatMessage[]> {
    const result = await this.request(
      `/chat-messages/thread/${encodeURIComponent(threadId)}?limit=${String(limit)}`,
      paginatedSchema(messageSchema),
    );
    return result.data;
  }

  async uploadFile(input: ChatAttachment, signal?: AbortSignal): Promise<UploadedFile> {
    return this.request('/files/upload', uploadedFileSchema, {
      body: {
        content: input.content,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    });
  }

  async deleteFile(id: string): Promise<void> {
    await this.request(`/files/${encodeURIComponent(id)}`, z.unknown(), {
      method: 'DELETE',
    });
  }

  async sendMessage(input: MessageRequest, signal?: AbortSignal): Promise<ChatMessage> {
    return this.request('/chat-messages', messageSchema, {
      body: input,
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    });
  }

  async compare(input: CompareRequest, signal?: AbortSignal): Promise<ParallelResponse> {
    return this.request('/chat-messages/parallel', parallelResponseSchema, {
      body: input,
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    });
  }

  async cancelStream(threadId: string): Promise<void> {
    await this.request(
      `/chat-messages/stream/${encodeURIComponent(threadId)}/cancel`,
      z.unknown(),
      {
        method: 'POST',
      },
    );
  }

  async openStream(threadId: string, signal?: AbortSignal): Promise<Response> {
    const path = `/chat-messages/stream/${encodeURIComponent(threadId)}?replay=false`;
    return this.openAuthenticatedStream(path, signal);
  }

  private async openAuthenticatedStream(path: string, signal?: AbortSignal): Promise<Response> {
    await this.ensureFreshSession(signal);
    let response = await this.send(path, {
      accept: 'text/event-stream',
      auth: true,
      method: 'GET',
      ...(signal === undefined ? {} : { signal }),
    });
    if (response.response.status === 401) {
      await discardResponseBody(response);
      await this.refresher.run(signal);
      response = await this.send(path, {
        accept: 'text/event-stream',
        auth: true,
        method: 'GET',
        ...(signal === undefined ? {} : { signal }),
      });
    }
    if (!response.response.ok) {
      await this.throwResponseError(response);
    }
    const streamResponse = responseWithIdleTimeout(response.response, this.timeoutMs, signal);
    response.release();
    return streamResponse;
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    options: {
      method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      body?: unknown;
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    await this.ensureFreshSession(options.signal);
    const attempt = {
      auth: true as const,
      method: options.method ?? ('GET' as const),
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    };
    let response = await this.send(path, attempt);
    if (response.response.status === 401) {
      await discardResponseBody(response);
      await this.refresher.run(options.signal);
      response = await this.send(path, attempt);
    }
    return this.parse(response, schema);
  }

  /**
   * Rotate the session before it can fail, not after it already has.
   *
   * Reacting to a 401 alone left a hole nothing could close: an agent run in
   * flight would spend a request on the failure, and any refresh that lost its
   * race dropped the panel to "Connect to ClawAI" with the run still going. A
   * request that is about to travel on a nearly dead access token rotates it
   * first, so the expiry is never observed by the backend or the user.
   *
   * A rotation that fails for a transient reason is swallowed on purpose: the
   * current token has not expired yet, the request is still worth sending, and
   * the 401 path retries the rotation if it turns out it was needed. Only a
   * genuinely dead session propagates, because that one needs sign-in.
   */
  private async ensureFreshSession(signal?: AbortSignal): Promise<void> {
    const session = await this.sessionVault.loadBound(this.backendUrl);
    if (session === null) {
      return;
    }
    this.bindSession(session);
    if (
      !accessTokenNeedsRefresh(session.tokens.accessToken, Date.now(), ACCESS_TOKEN_REFRESH_SKEW_MS)
    ) {
      return;
    }
    try {
      await this.refresher.run(signal);
    } catch (error: unknown) {
      signal?.throwIfAborted();
      if (isBackendSessionBoundaryError(error)) {
        throw error;
      }
    }
  }

  private async performRefresh(signal: AbortSignal): Promise<void> {
    const outcome = await this.sessionVault.refreshIfCurrent(
      this.backendUrl,
      signal,
      (tokens) => this.rotateSession(tokens.refreshToken, signal),
      this.boundSessionId ?? undefined,
    );
    if (outcome === 'missing') {
      throw new BackendRequestError('Connect to ClawAI to continue.', 401, false);
    }
  }

  /**
   * Exchange the stored refresh token for a rotated pair.
   *
   * The rotated pair is returned even when the caller's signal aborted while
   * the response was in flight. The backend has already consumed the old token
   * by then, so throwing here would leave a dead credential in storage and make
   * the next refresh look like a replay attack — the vault decides whether the
   * replacement is still wanted.
   */
  private async rotateSession(refreshToken: string, signal: AbortSignal): Promise<TokenPair> {
    try {
      const response = await this.send('/auth/refresh', {
        auth: false,
        body: { refreshToken },
        method: 'POST',
        signal,
      });
      const result = await this.parse(response, refreshResultSchema);
      return result.tokens;
    } catch (error: unknown) {
      if (error instanceof BackendRequestError && error.status === 401) {
        if (this.boundSessionId !== null) {
          await this.sessionVault.clearIfSession(this.backendUrl, this.boundSessionId);
        }
        throw this.refresher.terminate();
      }
      throw error;
    }
  }

  private async send(
    path: string,
    options: {
      accept?: string;
      accessToken?: string;
      auth: boolean;
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      body?: unknown;
      signal?: AbortSignal;
      timeoutMs?: number;
    },
  ): Promise<ResponseLease> {
    const headers: Record<string, string> = {
      Accept: options.accept ?? 'application/json',
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.accessToken !== undefined) {
      headers.Authorization = `Bearer ${options.accessToken}`;
    } else if (options.auth) {
      const session = await this.sessionVault.loadBound(this.backendUrl);
      if (session === null) {
        throw new BackendRequestError('Connect to ClawAI to continue.', 401, false);
      }
      this.bindSession(session);
      headers.Authorization = `Bearer ${session.tokens.accessToken}`;
    }

    const timeoutController = new AbortController();
    const timeout = setTimeout(() => {
      timeoutController.abort(new Error('ClawAI request timed out.'));
    }, options.timeoutMs ?? this.timeoutMs);
    const signal =
      options.signal === undefined
        ? timeoutController.signal
        : AbortSignal.any([options.signal, timeoutController.signal]);

    try {
      const response = await this.fetcher(joinApiUrl(this.backendUrl, path), {
        method: options.method,
        headers,
        signal,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      return {
        ...(options.signal === undefined ? {} : { callerSignal: options.signal }),
        release: () => {
          clearTimeout(timeout);
        },
        response,
        signal,
      };
    } catch (error: unknown) {
      clearTimeout(timeout);
      options.signal?.throwIfAborted();
      const message = backendTransportFailureMessage(error, timeoutController.signal.aborted);
      throw new BackendRequestError(message, 0, true);
    }
  }

  private async parse<T>(lease: ResponseLease, schema: z.ZodType<T>): Promise<T> {
    if (!lease.response.ok) {
      await this.throwResponseError(lease);
    }
    if (lease.response.status === 204) {
      lease.release();
      return schema.parse(undefined);
    }
    const text = await this.readResponseBody(lease, MAX_SUCCESS_BODY_BYTES);
    const body: unknown = JSON.parse(text);
    return schema.parse(body);
  }

  private async readResponseBody(lease: ResponseLease, limitBytes: number): Promise<string> {
    try {
      return await readBoundedResponseText(lease, limitBytes);
    } catch (error: unknown) {
      lease.callerSignal?.throwIfAborted();
      if (error instanceof ResponseBodyLimitError) {
        throw new BackendRequestError(error.message, lease.response.status, false);
      }
      const message =
        error instanceof Error ? redactText(error.message) : 'Backend response failed.';
      throw new BackendRequestError(message, 0, true);
    }
  }

  private async throwResponseError(lease: ResponseLease): Promise<never> {
    const body = await this.readResponseBody(lease, MAX_ERROR_BODY_BYTES);
    const safeBody = redactText(body).trim();
    const statusMessage = `ClawAI request failed (${String(lease.response.status)}).`;
    // A platform error carries its own reason and code; showing the raw JSON
    // envelope around them made every backend failure unreadable in the panel.
    const reason = backendErrorReason(safeBody);
    throw new BackendRequestError(
      reason ?? (safeBody.length === 0 ? statusMessage : `${statusMessage} ${safeBody}`),
      lease.response.status,
      lease.response.status === 408 ||
        lease.response.status === 429 ||
        lease.response.status >= 500,
    );
  }
}
