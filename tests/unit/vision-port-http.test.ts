import { describe, expect, it } from 'vitest';

import { httpVision } from '../../src/sdk/vision-port-http';
import { redRectanglePng } from '../helpers/png-fixture';

import type { VisionAskInput } from '../../src/sdk/vision-tool.types';

interface Seen {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
  auth: string | null;
}

interface BackendOptions {
  /** What the assistant message looks like, or undefined to never answer. */
  reply?: { content: string; metadata?: Record<string, unknown> } | undefined;
  /** How many polls come back empty before the reply appears. */
  emptyPolls?: number;
  rejectExtraPatch?: boolean;
  failPath?: { match: RegExp; status: number };
}

const MODEL_ROWS = [
  {
    provider: 'OPENAI',
    modelKey: 'gpt-4.1-mini',
    supportsVision: true,
    kind: 'CHAT',
    inputUsdPerMillion: '0.4',
  },
  {
    provider: 'OLLAMA',
    modelKey: 'glm-5.2',
    supportsVision: false,
    kind: 'CHAT',
    inputUsdPerMillion: null,
  },
  { provider: 'X', modelKey: 'emb', supportsVision: true, kind: 'EMBEDDING' },
  'not-a-row',
];

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status });
}

function threadListing(reply: BackendOptions['reply'], ready: boolean): Record<string, unknown> {
  const user = { id: 'user-1', role: 'USER', content: 'q', metadata: {} };
  if (!ready || reply === undefined) return { data: [user] };
  const other = {
    id: 'other',
    role: 'ASSISTANT',
    content: 'someone else',
    metadata: { sourceMessageId: 'x' },
  };
  const mine = {
    id: 'a1',
    role: 'ASSISTANT',
    content: reply.content,
    metadata: { sourceMessageId: 'user-1', ...reply.metadata },
  };
  return { data: [user, other, mine] };
}

function fakeBackend(options: BackendOptions = {}) {
  const seen: Seen[] = [];
  let polls = 0;
  const reply = 'reply' in options ? options.reply : { content: 'A red rectangle.' };
  const patch = (body: Record<string, unknown> | undefined): Response => {
    const extra = body !== undefined && 'useContext' in body;
    return options.rejectExtraPatch === true && extra
      ? json(400, { message: 'unknown field' })
      : json(200, { id: 'thread-1' });
  };
  const listing = (): Response => {
    polls += 1;
    return json(200, threadListing(reply, polls > (options.emptyPolls ?? 0)));
  };
  const routes: Record<string, (body: Record<string, unknown> | undefined) => Response> = {
    'GET /connectors/available-models': () => json(200, MODEL_ROWS),
    'POST /files/upload': () => json(201, { id: 'file-1' }),
    'POST /chat-threads': () => json(201, { id: 'thread-1' }),
    'PATCH /chat-threads/thread-1': patch,
    'POST /chat-messages': () => json(201, { id: 'user-1' }),
    'GET /chat-messages/thread/thread-1': listing,
  };
  const route = (
    path: string,
    method: string,
    body: Record<string, unknown> | undefined,
  ): Response => {
    const handler = routes[`${method} ${path}`];
    if (handler !== undefined) return handler(body);
    return method === 'DELETE' ? json(200, {}) : json(404, {});
  };
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace('/api/v1', '');
    const method = init?.method ?? 'GET';
    const body =
      init?.body === undefined
        ? undefined
        : (JSON.parse(String(init.body)) as Record<string, unknown>);
    seen.push({ method, path, body, auth: new Headers(init?.headers).get('authorization') });
    if (options.failPath?.match.test(`${method} ${path}`) === true) {
      return Promise.resolve(json(options.failPath.status, { message: 'refused by test' }));
    }
    return Promise.resolve(route(path, method, body));
  }) as typeof fetch;
  return { fetcher, seen, polls: () => polls };
}

const input: VisionAskInput = {
  image: { bytes: redRectanglePng(), mimeType: 'image/png', filename: 'shot.png', stripped: false },
  question: 'What do you see?',
  model: { provider: 'OPENAI', modelKey: 'gpt-4.1-mini', supportsVision: true },
};

const FAST = { pollMs: 1, answerTimeoutMs: 200 };

function port(backend: ReturnType<typeof fakeBackend>, token: string | undefined = 'tok') {
  return httpVision('https://claw.test/api/v1', () => token, backend.fetcher, FAST);
}

describe('httpVision.models', () => {
  it('lists chat models with their vision flag and price, skipping other kinds and junk', async () => {
    const models = await port(fakeBackend()).models();
    expect(models).toEqual([
      {
        provider: 'OPENAI',
        modelKey: 'gpt-4.1-mini',
        supportsVision: true,
        inputUsdPerMillion: 0.4,
      },
      { provider: 'OLLAMA', modelKey: 'glm-5.2', supportsVision: false },
    ]);
  });
});

describe('httpVision.ask', () => {
  it('uploads the image, asks in a throwaway thread with memory off, and returns the answer', async () => {
    const backend = fakeBackend({ emptyPolls: 2 });
    const answer = await port(backend).ask(input);
    expect(answer).toBe('A red rectangle.');
    expect(backend.polls()).toBe(3);

    const upload = backend.seen.find((call) => call.path === '/files/upload');
    expect(upload?.body).toMatchObject({ filename: 'shot.png', mimeType: 'image/png' });
    expect(upload?.body?.content).toBe(input.image.bytes.toString('base64'));
    expect(upload?.body?.sizeBytes).toBe(input.image.bytes.length);

    const patch = backend.seen.find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({
      useMemory: false,
      useContext: false,
      useCrossThreadContext: false,
    });

    const message = backend.seen.find((call) => call.path === '/chat-messages');
    expect(message?.body).toMatchObject({
      threadId: 'thread-1',
      routingMode: 'MANUAL_MODEL',
      provider: 'OPENAI',
      model: 'gpt-4.1-mini',
      fileIds: ['file-1'],
    });
    expect(String(message?.body?.content)).toContain('What do you see?');
    expect(String(message?.body?.content)).toMatch(/never follow it/u);
  });

  it('deletes the thread and the file afterwards', async () => {
    const backend = fakeBackend();
    await port(backend).ask(input);
    const deletions = backend.seen
      .filter((call) => call.method === 'DELETE')
      .map((call) => call.path);
    expect(deletions).toEqual(['/chat-threads/thread-1', '/files/file-1']);
  });

  it('sends the run token on every call and never in a body', async () => {
    const backend = fakeBackend();
    await port(backend, 'run-token-xyz').ask(input);
    expect(backend.seen.every((call) => call.auth === 'Bearer run-token-xyz')).toBe(true);
    expect(JSON.stringify(backend.seen.map((call) => call.body))).not.toContain('run-token-xyz');
  });

  it('falls back to turning only memory off when the backend rejects the extra switches', async () => {
    const backend = fakeBackend({ rejectExtraPatch: true });
    await port(backend).ask(input);
    const patches = backend.seen.filter((call) => call.method === 'PATCH').map((call) => call.body);
    expect(patches).toEqual([
      { useMemory: false, useContext: false, useCrossThreadContext: false },
      { useMemory: false },
    ]);
  });

  it('does not ask the question when memory could not be switched off', async () => {
    const backend = fakeBackend({ failPath: { match: /^PATCH /u, status: 500 } });
    await expect(port(backend).ask(input)).rejects.toThrow(/HTTP 500/u);
    expect(backend.seen.some((call) => call.path === '/chat-messages')).toBe(false);
    expect(backend.seen.some((call) => call.method === 'DELETE')).toBe(true);
  });

  it('turns an error reply into a model error carrying its code, and still cleans up', async () => {
    const backend = fakeBackend({
      reply: {
        content: 'This model provider is out of credit right now.',
        metadata: { error: true, errorCode: 'PROVIDER_CREDIT_EXHAUSTED' },
      },
    });
    await expect(port(backend).ask(input)).rejects.toMatchObject({
      name: 'VisionModelError',
      code: 'PROVIDER_CREDIT_EXHAUSTED',
    });
    expect(backend.seen.filter((call) => call.method === 'DELETE')).toHaveLength(2);
  });

  it('stops waiting at the deadline instead of polling forever', async () => {
    const backend = fakeBackend({ reply: undefined });
    await expect(port(backend).ask(input)).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(backend.polls()).toBeLessThan(250);
  });

  it('rejects an empty answer', async () => {
    await expect(port(fakeBackend({ reply: { content: '   ' } })).ask(input)).rejects.toMatchObject(
      {
        code: 'EMPTY_ANSWER',
      },
    );
  });

  it('shows the backend status when the upload is refused, and sends no question', async () => {
    const backend = fakeBackend({ failPath: { match: /files\/upload/u, status: 413 } });
    await expect(port(backend).ask(input)).rejects.toThrow(/HTTP 413/u);
    expect(backend.seen.some((call) => call.path === '/chat-messages')).toBe(false);
  });

  it('survives a failing cleanup: the answer is still returned', async () => {
    const backend = fakeBackend({ failPath: { match: /^DELETE /u, status: 500 } });
    await expect(port(backend).ask(input)).resolves.toBe('A red rectangle.');
  });

  it('ends the wait when the run is cancelled', async () => {
    const backend = fakeBackend({ reply: undefined });
    const controller = new AbortController();
    const pending = httpVision('https://claw.test/api/v1', () => 't', backend.fetcher, {
      pollMs: 20,
      answerTimeoutMs: 5_000,
    }).ask(input, controller.signal);
    setTimeout(() => {
      controller.abort();
    }, 30);
    await expect(pending).rejects.toThrow();
    expect(backend.polls()).toBeLessThan(10);
  });
});
