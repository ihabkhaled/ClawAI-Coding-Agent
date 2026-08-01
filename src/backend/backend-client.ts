import { z } from 'zod';

import { joinApiUrl, normalizeBackendUrl } from '../core/configuration';
import { redactText } from '../core/redaction';
import { type SessionVault, type TokenPair } from '../core/session-vault';

import {
  BackendRequestError,
  BackendSessionChangedError,
  BackendSessionExpiredError,
} from './backend-errors';
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
  waitForCaller,
} from './response-lease';

import type { ChatAttachment } from '../core/chat-attachment';
import type { ResearchMode } from '../core/research-mode';

export {
  BackendRequestError,
  BackendSessionChangedError,
  BackendSessionExpiredError,
} from './backend-errors';

const MAX_ERROR_BODY_BYTES = 64_000;
const MAX_SUCCESS_BODY_BYTES = 8_000_000;

export interface BackendClientOptions {
  backendUrl: string;
  timeoutMs: number;
  sessionVault: SessionVault;
  fetcher?: typeof fetch;
  clientName?: string;
}

export interface MessageRequest {
  threadId: string;
  content: string;
  clientIntent?: string;
  routingMode: 'AUTO' | 'MANUAL_MODEL';
  provider?: string;
  model?: string;
  modelDisplayName?: string;
  researchMode?: ResearchMode;
  fileIds?: string[];
}

export interface CompareRequest {
  threadId?: string;
  content: string;
  models: {
    provider: string;
    model: string;
  }[];
  judgeEnabled?: boolean;
  judgeModel?: string | null;
  fileIds?: string[];
  researchMode?: ResearchMode;
}

function transportFailureMessage(error: unknown, timedOut: boolean): string {
  if (!timedOut) {
    return 'ClawAI backend is unavailable. Check the app address or start the services, then retry.';
  }
  return error instanceof Error ? redactText(error.message) : 'ClawAI request timed out.';
}

export class BackendClient {
  private readonly backendUrl: string;
  private readonly clientName: string;
  private readonly fetcher: typeof fetch;
  private readonly sessionVault: SessionVault;
  private readonly timeoutMs: number;
  private boundSessionId: string | null = null;
  private refreshController: AbortController | null = null;
  private refreshPromise: Promise<void> | null = null;

  constructor(options: BackendClientOptions) {
    this.backendUrl = normalizeBackendUrl(options.backendUrl);
    this.clientName = options.clientName ?? 'ClawAI for VS Code';
    this.fetcher = options.fetcher ?? fetch;
    this.sessionVault = options.sessionVault;
    this.timeoutMs = options.timeoutMs;
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

  async logout(): Promise<void> {
    this.refreshController?.abort(new Error('ClawAI session ended.'));
    const current = await this.sessionVault.loadBound(this.backendUrl);
    if (current === null) {
      return;
    }
    this.bindSession(current.sessionId);
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
    let response = await this.send(path, {
      accept: 'text/event-stream',
      auth: true,
      method: 'GET',
      ...(signal === undefined ? {} : { signal }),
    });
    if (response.response.status === 401) {
      await discardResponseBody(response);
      await this.refreshSession(signal);
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
    } = {},
  ): Promise<T> {
    let response = await this.send(path, {
      auth: true,
      method: options.method ?? 'GET',
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (response.response.status === 401) {
      await discardResponseBody(response);
      await this.refreshSession(options.signal);
      response = await this.send(path, {
        auth: true,
        method: options.method ?? 'GET',
        ...(options.body === undefined ? {} : { body: options.body }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    }
    return this.parse(response, schema);
  }

  private refreshSession(signal?: AbortSignal): Promise<void> {
    let promise = this.refreshPromise;
    if (promise === null) {
      const controller = new AbortController();
      promise = this.performRefresh(controller.signal);
      const ownedPromise = promise;
      this.refreshPromise = promise;
      this.refreshController = controller;
      void ownedPromise.then(
        () => {
          this.finishRefresh(ownedPromise, controller);
        },
        () => {
          this.finishRefresh(ownedPromise, controller);
        },
      );
    }
    return waitForCaller(promise, signal);
  }

  private finishRefresh(promise: Promise<void>, controller: AbortController): void {
    if (this.refreshPromise === promise) {
      this.refreshPromise = null;
    }
    if (this.refreshController === controller) {
      this.refreshController = null;
    }
  }

  private async performRefresh(signal: AbortSignal): Promise<void> {
    const outcome = await this.sessionVault.refreshIfCurrent(
      this.backendUrl,
      signal,
      async (tokens) => {
        let result;
        try {
          const response = await this.send('/auth/refresh', {
            auth: false,
            body: {
              refreshToken: tokens.refreshToken,
            },
            method: 'POST',
            signal,
          });
          result = await this.parse(response, refreshResultSchema);
        } catch (error) {
          if (error instanceof BackendRequestError && error.status === 401) {
            if (this.boundSessionId !== null) {
              await this.sessionVault.clearIfSession(this.backendUrl, this.boundSessionId);
            }
            throw new BackendSessionExpiredError();
          }
          throw error;
        }
        signal.throwIfAborted();
        return result.tokens;
      },
      this.boundSessionId ?? undefined,
    );
    if (outcome === 'missing') {
      throw new BackendRequestError('Connect to ClawAI to continue.', 401, false);
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
      this.bindSession(session.sessionId);
      headers.Authorization = `Bearer ${session.tokens.accessToken}`;
    }

    const timeoutController = new AbortController();
    const timeout = setTimeout(() => {
      timeoutController.abort(new Error('ClawAI request timed out.'));
    }, this.timeoutMs);
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
      const message = transportFailureMessage(error, timeoutController.signal.aborted);
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

  private bindSession(sessionId: string): void {
    if (this.boundSessionId === null) {
      this.boundSessionId = sessionId;
      return;
    }
    if (this.boundSessionId !== sessionId) {
      throw new BackendSessionChangedError();
    }
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
    throw new BackendRequestError(
      safeBody.length === 0 ? statusMessage : `${statusMessage} ${safeBody}`,
      lease.response.status,
      lease.response.status === 408 ||
        lease.response.status === 429 ||
        lease.response.status >= 500,
    );
  }
}
