import { createHash, randomUUID } from 'node:crypto';

import { HEADLESS_CALLBACK_URI, HEADLESS_CLIENT_NAME } from './headless-session.constants';

import type { HeadlessStreamEvent } from './headless-session.types';
import type { HeadlessCredentials, HeadlessRunRequest } from './headless-transport.types';

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
  constructor(private readonly baseUrl: string) {}

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
    const thread = await this.json<{ id?: string; data?: { id: string } }>('/chat-threads', {
      body: { title, routingMode: 'MANUAL_MODEL' },
      token,
    });
    const id = thread.id ?? thread.data?.id;
    if (id === undefined) throw new Error('Thread creation returned no identifier');
    return id;
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

  /**
   * The run's events, one at a time.
   *
   * Frames are reassembled across chunk boundaries because a server-sent event
   * is not guaranteed to arrive whole, and a half-parsed frame is silently
   * dropped rather than reported, which is how a run appears to end on nothing.
   */
  async *events(
    token: string,
    run: { runId: string; generation: string; threadId: string },
  ): AsyncGenerator<HeadlessStreamEvent> {
    const query = new URLSearchParams({
      protocol: 'v2',
      runId: run.runId,
      generation: run.generation,
      after: '0',
    });
    const response = await fetch(
      `${this.baseUrl}/chat-messages/stream/${encodeURIComponent(run.threadId)}?${query.toString()}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' } },
    );
    if (!response.ok || response.body === null) {
      throw new Error(`Event stream refused: HTTP ${String(response.status)}`);
    }
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of streamChunks(response.body)) {
      buffer += decoder.decode(chunk, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const event = parseFrame(frame);
        if (event !== undefined) yield event;
      }
    }
  }

  private async json<T>(path: string, options: { body: unknown; token?: string }): Promise<T> {
    const response = await fetch(this.baseUrl + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token === undefined ? {} : { Authorization: `Bearer ${options.token}` }),
      },
      body: JSON.stringify(options.body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${path} refused: HTTP ${String(response.status)} ${text.slice(0, 300)}`);
    }
    return (text.length === 0 ? {} : JSON.parse(text)) as T;
  }
}

async function* streamChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(frame: string): HeadlessStreamEvent | undefined {
  const line = frame.split('\n').find((candidate) => candidate.startsWith('data:'));
  if (line === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(line.slice(5).trim());
    if (parsed === null || typeof parsed !== 'object') return undefined;
    const event = parsed as { type?: unknown; payload?: unknown };
    if (typeof event.type !== 'string') return undefined;
    return {
      type: event.type,
      ...(isRecord(event.payload) ? { payload: event.payload } : {}),
    };
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
