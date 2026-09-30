import { createHash, randomUUID } from 'node:crypto';

import { threadOriginForSource } from '../core/thread-source';
import { LEGACY_CLI_THREAD_ORIGIN } from '../core/thread-source.constants';

import { HEADLESS_CALLBACK_URI, HEADLESS_CLIENT_NAME } from './headless-session.constants';
import { withRetries } from './retry-policy';
import { readRuntimeEvents } from './runtime-event-stream';
import { RuntimeHttpError } from './runtime-http-error';

import type { HeadlessStreamEvent } from './headless-session.types';
import type { HeadlessCredentials, HeadlessRunRequest } from './headless-transport.types';
import type { RetryContext } from './retry-policy.types';

export function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

/**
 * The backend's canonical JSON, used for the one hash it verifies.
 *
 * Keys are sorted, and an empty array is written as an empty object. The second
 * rule reads as a bug and is not: runtime events pass through a state machine
 * whose JSON decoder cannot tell an empty array from an empty object, so both
 * sides agree to call it an object rather than disagree about a hash.
 *
 * Only the tool-result receipt uses this. The tool catalog and the manifest are
 * hashed with a plain serialization, and using the wrong one of the two is a
 * server error with no detail attached, which is why both are named here.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return value.length === 0 ? '{}' : `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  throw new Error('Headless payload is not JSON compatible');
}

export class HeadlessTransport {
  /**
   * `retry` makes every call survive a runtime that is briefly away — a deploy,
   * a restart, a store blip — by waiting and asking again; see `withRetries`.
   * A retried call sends the same body, so the idempotency key inside it is the
   * same and the runtime recognises the repeat instead of doing the work twice.
   */
  constructor(
    private readonly baseUrl: string,
    private readonly retry: RetryContext = {},
  ) {}

  /**
   * Completes the VS Code authorization without a browser.
   *
   * The approval step is an ordinary authenticated call. The page a person sees
   * in the product is a client for it, not a gate in front of it — which is the
   * only reason a headless run can authenticate at all.
   */
  async signIn(credentials: HeadlessCredentials): Promise<string> {
    const verifier = Buffer.from(`${randomUUID()}${randomUUID()}`)
      .subarray(0, 32)
      .toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = Buffer.from(`${randomUUID()}${randomUUID()}`)
      .subarray(0, 32)
      .toString('base64url');

    const login = await this.json<{ tokens: { accessToken: string } }>('/auth/login', {
      body: { email: credentials.email, password: credentials.password },
    });
    const init = await this.json<{ requestId: string }>('/auth/vscode/authorize/init', {
      body: {
        callbackUri: HEADLESS_CALLBACK_URI,
        state,
        codeChallenge: challenge,
        clientName: HEADLESS_CLIENT_NAME,
      },
    });
    const approval = await this.json<{ redirectUri: string }>('/auth/vscode/authorize/approve', {
      body: { requestId: init.requestId },
      token: login.tokens.accessToken,
    });
    const code = new URL(approval.redirectUri).searchParams.get('code');
    if (code === null) throw new Error('Authorization approval returned no code');
    const exchanged = await this.json<{ tokens: { accessToken: string } }>(
      '/auth/vscode/authorize/exchange',
      { body: { code, codeVerifier: verifier } },
    );
    return exchanged.tokens.accessToken;
  }

  async createThread(token: string, title: string): Promise<string> {
    // The CLI's own origin, which the backend lists in the shared agent history
    // so a CLI run is resumable from VS Code, labelled as a CLI thread (F094).
    // Omitted, the backend files it as WEB.
    try {
      return await this.postThread(token, title, threadOriginForSource('cli'));
    } catch (error) {
      // A backend older than CODING_AGENT_CLI rejects it as an unknown origin.
      // The shared agent origin keeps the run in the same history there.
      if (error instanceof RuntimeHttpError && error.status === 400) {
        return this.postThread(token, title, LEGACY_CLI_THREAD_ORIGIN);
      }
      throw error;
    }
  }

  private async postThread(token: string, title: string, origin: string): Promise<string> {
    const thread = await this.json<{ id?: string; data?: { id: string } }>('/chat-threads', {
      body: { title, routingMode: 'MANUAL_MODEL', origin },
      token,
    });
    const id = thread.id ?? thread.data?.id;
    if (id === undefined) throw new Error('Thread creation returned no identifier');
    return id;
  }

  /**
   * Turns the account's stored personal memories off (or on) for one thread.
   *
   * The create-thread request cannot carry this, so it is a separate update.
   * Throws `RuntimeHttpError` on a refusal; the caller decides whether that
   * matters. Transient failures are retried like every other call.
   */
  async setThreadMemory(token: string, threadId: string, useMemory: boolean): Promise<void> {
    await this.json(`/chat-threads/${encodeURIComponent(threadId)}`, {
      method: 'PATCH',
      body: { useMemory },
      token,
    });
  }

  startRun(
    token: string,
    request: HeadlessRunRequest,
  ): Promise<{ runId: string; generation: string }> {
    return this.json<{ runId: string; generation: string }>('/chat-messages/runtime/runs', {
      body: request,
      token,
    });
  }

  submitResult(
    token: string,
    run: { runId: string; generation: string; threadId: string },
    epochs: unknown,
    result: unknown,
  ): Promise<unknown> {
    const query = new URLSearchParams({ threadId: run.threadId });
    return this.json(
      `/chat-messages/runtime/runs/${encodeURIComponent(run.runId)}/results?${query.toString()}`,
      {
        body: {
          generation: run.generation,
          idempotencyKey: `idem.${randomUUID()}`,
          epochs,
          result,
        },
        token,
      },
    );
  }

  /** The run's events, reconnecting from the last one seen; see `readRuntimeEvents`. */
  events(
    token: string,
    run: { runId: string; generation: string; threadId: string },
    signal?: AbortSignal,
  ): AsyncGenerator<HeadlessStreamEvent> {
    return readRuntimeEvents({
      baseUrl: this.baseUrl,
      token,
      run,
      signal,
      retry: { ...this.retry, signal: signal ?? this.retry.signal },
    });
  }

  private async json<T>(
    path: string,
    options: { body: unknown; token?: string; method?: 'POST' | 'PATCH' },
  ): Promise<T> {
    // Serialized once, outside the retry, so every attempt sends identical bytes.
    const payload = JSON.stringify(options.body);
    return withRetries(this.retry, async () => {
      const response = await fetch(this.baseUrl + path, {
        method: options.method ?? 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(options.token === undefined ? {} : { Authorization: `Bearer ${options.token}` }),
        },
        body: payload,
        ...(this.retry.signal === undefined ? {} : { signal: this.retry.signal }),
      });
      const text = await response.text();
      if (!response.ok) throw RuntimeHttpError.fromResponse(path, response, text);
      return (text.length === 0 ? {} : JSON.parse(text)) as T;
    });
  }
}
