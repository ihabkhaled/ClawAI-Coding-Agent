import { z } from 'zod';

import { joinApiUrl, normalizeBackendUrl } from '../core/configuration';
import { redactText } from '../core/redaction';
import { type SessionVault } from '../core/session-vault';

import {
  connectorModelSchema,
  entitlementsSchema,
  loginResultSchema,
  messageSchema,
  paginatedSchema,
  parallelResponseSchema,
  refreshResultSchema,
  routerModelSchema,
  threadSchema,
  usageSchema,
  userProfileSchema,
  type ChatMessage,
  type ChatThread,
  type ConnectorModel,
  type Entitlements,
  type LoginResult,
  type ParallelResponse,
  type RouterModel,
  type Usage,
} from './contracts';

const MAX_ERROR_BODY_BYTES = 64_000;

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
  routingMode: 'AUTO' | 'MANUAL';
  provider?: string;
  model?: string;
  modelDisplayName?: string;
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
}

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

export class BackendClient {
  private readonly backendUrl: string;
  private readonly clientName: string;
  private readonly fetcher: typeof fetch;
  private readonly sessionVault: SessionVault;
  private readonly timeoutMs: number;
  private refreshPromise: Promise<void> | null = null;

  constructor(options: BackendClientOptions) {
    this.backendUrl = normalizeBackendUrl(options.backendUrl);
    this.clientName = options.clientName ?? 'ClawAI for VS Code';
    this.fetcher = options.fetcher ?? fetch;
    this.sessionVault = options.sessionVault;
    this.timeoutMs = options.timeoutMs;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const response = await this.send('/auth/login', {
      auth: false,
      body: {
        clientKind: 'VSCODE',
        clientName: this.clientName,
        email,
        password,
      },
      method: 'POST',
    });
    const result = await this.parse(response, loginResultSchema);
    await this.sessionVault.save(result.tokens);
    return result;
  }

  async logout(): Promise<void> {
    try {
      const response = await this.send('/auth/logout', {
        auth: true,
        method: 'POST',
      });
      if (!response.ok && response.status !== 401) {
        await this.throwResponseError(response);
      }
    } finally {
      await this.sessionVault.clear();
    }
  }

  async getProfile(): Promise<z.infer<typeof userProfileSchema>> {
    return this.request('/auth/me', userProfileSchema);
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

  async createThread(input: {
    title?: string;
    routingMode: 'AUTO' | 'MANUAL';
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

  async sendMessage(input: MessageRequest): Promise<ChatMessage> {
    return this.request('/chat-messages', messageSchema, {
      body: input,
      method: 'POST',
    });
  }

  async compare(input: CompareRequest): Promise<ParallelResponse> {
    return this.request('/chat-messages/parallel', parallelResponseSchema, {
      body: input,
      method: 'POST',
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
    let response = await this.send(`/chat-messages/stream/${encodeURIComponent(threadId)}`, {
      accept: 'text/event-stream',
      auth: true,
      method: 'GET',
      ...(signal === undefined ? {} : { signal }),
    });
    if (response.status === 401) {
      await this.refreshSession();
      response = await this.send(`/chat-messages/stream/${encodeURIComponent(threadId)}`, {
        accept: 'text/event-stream',
        auth: true,
        method: 'GET',
        ...(signal === undefined ? {} : { signal }),
      });
    }
    if (!response.ok) {
      await this.throwResponseError(response);
    }
    return response;
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
    if (response.status === 401) {
      await this.refreshSession();
      response = await this.send(path, {
        auth: true,
        method: options.method ?? 'GET',
        ...(options.body === undefined ? {} : { body: options.body }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    }
    return this.parse(response, schema);
  }

  private async refreshSession(): Promise<void> {
    if (this.refreshPromise !== null) {
      return this.refreshPromise;
    }
    this.refreshPromise = this.performRefresh();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async performRefresh(): Promise<void> {
    const tokens = await this.sessionVault.load();
    if (tokens === null) {
      throw new BackendRequestError('Connect to ClawAI to continue.', 401, false);
    }
    const response = await this.send('/auth/refresh', {
      auth: false,
      body: {
        refreshToken: tokens.refreshToken,
      },
      method: 'POST',
    });
    const result = await this.parse(response, refreshResultSchema);
    await this.sessionVault.save(result.tokens);
  }

  private async send(
    path: string,
    options: {
      accept?: string;
      auth: boolean;
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      body?: unknown;
      signal?: AbortSignal;
    },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: options.accept ?? 'application/json',
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.auth) {
      const tokens = await this.sessionVault.load();
      if (tokens === null) {
        throw new BackendRequestError('Connect to ClawAI to continue.', 401, false);
      }
      headers.Authorization = `Bearer ${tokens.accessToken}`;
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
      return await this.fetcher(joinApiUrl(this.backendUrl, path), {
        method: options.method,
        headers,
        signal,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? redactText(error.message) : 'Backend request failed.';
      throw new BackendRequestError(message, 0, true);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    if (!response.ok) {
      await this.throwResponseError(response);
    }
    if (response.status === 204) {
      return schema.parse(undefined);
    }
    const body: unknown = await response.json();
    return schema.parse(body);
  }

  private async throwResponseError(response: Response): Promise<never> {
    const body = (await response.text()).slice(0, MAX_ERROR_BODY_BYTES);
    const safeBody = redactText(body).trim();
    const statusMessage = `ClawAI request failed (${String(response.status)}).`;
    throw new BackendRequestError(
      safeBody.length === 0 ? statusMessage : `${statusMessage} ${safeBody}`,
      response.status,
      response.status === 408 || response.status === 429 || response.status >= 500,
    );
  }
}
