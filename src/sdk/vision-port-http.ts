import { threadOriginForSource } from '../core/thread-source';
import { RuntimeHttpError } from '../headless/runtime-http-error';

import { VisionModelError } from './vision-errors';
import {
  VISION_ANSWER_TIMEOUT_MS,
  VISION_POLL_INTERVAL_MS,
  VISION_PROMPT_FRAME,
  VISION_REQUEST_TIMEOUT_MS,
  VISION_THREAD_TITLE,
} from './vision-tool.constants';

import type { VisionAskInput, VisionCatalogModel, VisionPort } from './vision-tool.types';

/** Waiting knobs, shortened in tests. */
export interface VisionHttpTiming {
  readonly pollMs?: number;
  readonly answerTimeoutMs?: number;
}

interface Call {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly signal?: AbortSignal | undefined;
}

type Json = Record<string, unknown>;

/**
 * The vision tool over the same files and chat API the web chat uses.
 *
 * One question is one throwaway thread: the image is uploaded, a thread with
 * memory and context switched off is created, the question is sent to the
 * named model with the file attached, and the thread and the file are deleted
 * afterwards. Nothing about the user's real conversation reaches the model, and
 * nothing the model says lands in it.
 *
 * `token` is read per call because the run signs in after the toolkit is built.
 */
export function httpVision(
  baseUrl: string,
  token: () => string | undefined,
  fetcher: typeof fetch = fetch,
  timing: VisionHttpTiming = {},
): VisionPort {
  const call = async (path: string, options: Call = {}): Promise<Json> => {
    const bearer = token();
    const signal = AbortSignal.timeout(VISION_REQUEST_TIMEOUT_MS);
    const response = await fetcher(baseUrl + path, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: options.signal === undefined ? signal : AbortSignal.any([signal, options.signal]),
    });
    const text = await response.text();
    if (!response.ok) throw RuntimeHttpError.fromResponse(path, response, text);
    return text.length === 0 ? {} : (JSON.parse(text) as Json);
  };
  return {
    models: async (signal) => catalogFrom(await callList(call, signal)),
    ask: (input, signal) => askInThrowawayThread(call, input, timing, signal),
  };
}

type Caller = (path: string, options?: Call) => Promise<Json>;

async function callList(call: Caller, signal: AbortSignal | undefined): Promise<unknown> {
  // The catalog is a bare array, which `call` types as an object on purpose: it is only read here.
  return call('/connectors/available-models', { signal });
}

function catalogFrom(body: unknown): readonly VisionCatalogModel[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((entry: unknown): VisionCatalogModel[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const row = entry as Json;
    if (typeof row.provider !== 'string' || typeof row.modelKey !== 'string') return [];
    if (row.kind !== undefined && row.kind !== 'CHAT') return [];
    const price = Number(row.inputUsdPerMillion);
    return [
      {
        provider: row.provider,
        modelKey: row.modelKey,
        supportsVision: row.supportsVision === true,
        ...(row.inputUsdPerMillion === null ||
        row.inputUsdPerMillion === undefined ||
        Number.isNaN(price)
          ? {}
          : { inputUsdPerMillion: price }),
      },
    ];
  });
}

async function askInThrowawayThread(
  call: Caller,
  input: VisionAskInput,
  timing: VisionHttpTiming,
  signal: AbortSignal | undefined,
): Promise<string> {
  const cleanup: { fileId?: string; threadId?: string } = {};
  try {
    const file = await call('/files/upload', {
      method: 'POST',
      signal,
      body: {
        content: input.image.bytes.toString('base64'),
        filename: input.image.filename,
        mimeType: input.image.mimeType,
        sizeBytes: input.image.bytes.length,
      },
    });
    cleanup.fileId = idOf(file, 'file upload');
    const thread = await call('/chat-threads', {
      method: 'POST',
      signal,
      body: {
        title: VISION_THREAD_TITLE,
        routingMode: 'MANUAL_MODEL',
        origin: threadOriginForSource('cli'),
      },
    });
    cleanup.threadId = idOf(thread.data === undefined ? thread : (thread.data as Json), 'thread');
    await switchMemoryOff(call, cleanup.threadId, signal);
    const sent = await call('/chat-messages', {
      method: 'POST',
      signal,
      body: {
        threadId: cleanup.threadId,
        content: VISION_PROMPT_FRAME + input.question,
        routingMode: 'MANUAL_MODEL',
        provider: input.model.provider,
        model: input.model.modelKey,
        fileIds: [cleanup.fileId],
      },
    });
    return await awaitAnswer(call, cleanup.threadId, idOf(sent, 'message'), timing, signal);
  } finally {
    await removeQuietly(call, cleanup);
  }
}

function idOf(body: Json, what: string): string {
  if (typeof body.id === 'string' && body.id.length > 0) return body.id;
  throw new Error(`The ${what} returned no id.`);
}

/**
 * Memory, context and cross-thread context off: the question is about one
 * image, and a vision model must not be handed the user's stored memories. A
 * backend that refuses the extra switches still gets the one that matters; if
 * even that is refused the question is not asked.
 */
async function switchMemoryOff(
  call: Caller,
  threadId: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  const path = `/chat-threads/${encodeURIComponent(threadId)}`;
  try {
    await call(path, {
      method: 'PATCH',
      signal,
      body: { useMemory: false, useContext: false, useCrossThreadContext: false },
    });
  } catch (error) {
    if (!(error instanceof RuntimeHttpError) || error.status !== 400) throw error;
    await call(path, { method: 'PATCH', signal, body: { useMemory: false } });
  }
}

async function awaitAnswer(
  call: Caller,
  threadId: string,
  messageId: string,
  timing: VisionHttpTiming,
  signal: AbortSignal | undefined,
): Promise<string> {
  const pollMs = timing.pollMs ?? VISION_POLL_INTERVAL_MS;
  const deadline = Date.now() + (timing.answerTimeoutMs ?? VISION_ANSWER_TIMEOUT_MS);
  const path = `/chat-messages/thread/${encodeURIComponent(threadId)}`;
  for (;;) {
    await pause(pollMs, signal);
    const listing = await call(path, { signal });
    const reply = (Array.isArray(listing.data) ? (listing.data as Json[]) : []).find(
      (message) =>
        message.role === 'ASSISTANT' &&
        (message.metadata as Json | undefined)?.sourceMessageId === messageId,
    );
    if (reply !== undefined) return answerOf(reply);
    if (Date.now() >= deadline) {
      throw new VisionModelError('TIMEOUT', 'The vision model did not answer in time.');
    }
  }
}

function answerOf(reply: Json): string {
  const content = typeof reply.content === 'string' ? reply.content : '';
  const metadata = (reply.metadata ?? {}) as Json;
  if (metadata.error === true) {
    const code = typeof metadata.errorCode === 'string' ? metadata.errorCode : 'MODEL_ERROR';
    throw new VisionModelError(code, content.slice(0, 200));
  }
  if (content.trim().length === 0) {
    throw new VisionModelError('EMPTY_ANSWER', 'The vision model returned an empty answer.');
  }
  return content;
}

/** Deletes the throwaway thread and file; a failure here never hides the answer. */
async function removeQuietly(
  call: Caller,
  created: { fileId?: string; threadId?: string },
): Promise<void> {
  const deletions = [
    created.threadId === undefined
      ? undefined
      : `/chat-threads/${encodeURIComponent(created.threadId)}`,
    created.fileId === undefined ? undefined : `/files/${encodeURIComponent(created.fileId)}`,
  ];
  await Promise.all(
    deletions.map(async (path) => {
      if (path === undefined) return;
      try {
        await call(path, { method: 'DELETE' });
      } catch {
        // Best effort: an orphan thread or file is housekeeping, not a failed answer.
      }
    }),
  );
}

function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new Error('Cancelled'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Cancelled'));
      },
      { once: true },
    );
  });
}
