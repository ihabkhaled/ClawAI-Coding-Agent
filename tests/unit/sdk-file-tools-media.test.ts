import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { transcribableMediaKind } from '../../src/core/document-read-format';
import { TRANSCRIBE_MAX_BYTES } from '../../src/core/document-read-format.constants';
import { httpDocumentText } from '../../src/sdk/document-text-http';
import { httpMediaTranscribe } from '../../src/sdk/media-transcribe-http';
import { executeWorkspaceTool } from '../../src/sdk/workspace-tool-executor';

import type { PdfTextPort } from '../../src/backend/pdf-text-client';
import type { MediaTranscript } from '../../src/sdk/media-transcribe.types';

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'claw-media-'));
  created.push(directory);
  return directory;
}

function put(root: string, relative: string, content: string | Buffer): void {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function reader(root: string, documents: PdfTextPort | undefined) {
  return async (args: Record<string, unknown>): Promise<unknown> =>
    executeWorkspaceTool(
      { toolName: 'workspace.file', operation: 'read', arguments: args },
      { workspace: root, allowedExecutables: ['node'] },
      undefined,
      undefined,
      undefined,
      { documents },
    );
}

function portReturning(result: Partial<MediaTranscript> = {}) {
  const transcribe = vi.fn<NonNullable<PdfTextPort['transcribe']>>(async () => ({
    text: 'hello world',
    durationSeconds: 41.6,
    provider: 'openai',
    model: 'whisper',
    truncated: false,
    ...result,
  }));
  const documents: PdfTextPort = { extract: vi.fn(), transcribe };
  return { documents, transcribe };
}

function answer(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

function httpDocuments(fetcher: typeof fetch, token: string | null = 'tok'): PdfTextPort {
  const media = httpMediaTranscribe('http://x', () => token ?? undefined, fetcher);
  return { extract: vi.fn(), transcribe: media.transcribe };
}

describe('transcribableMediaKind', () => {
  it.each([
    ['a.mp3', 'audio'],
    ['a.M4A', 'audio'],
    ['a.webm', 'audio'],
    ['a.mp4', 'video'],
    ['a.mkv', 'video'],
    ['a.mov', 'video'],
    ['a.avi', undefined],
    ['a.opus', undefined],
    ['a.txt', undefined],
  ])('%s is %s', (file, kind) => {
    expect(transcribableMediaKind(file)).toBe(kind);
  });
});

describe('workspace.file read of audio and video', () => {
  it.each([
    ['mp3', 'audio'],
    ['mp4', 'video'],
  ])('transcribes a .%s file and shows the cost', async (ext, kind) => {
    const root = workspace();
    put(root, `m/a.${ext}`, Buffer.from([1, 2, 3]));
    const { documents, transcribe } = portReturning();

    const result = await reader(root, documents)({ path: `m/a.${ext}` });

    expect(result).toMatchObject({
      path: `m/a.${ext}`,
      kind,
      text: 'hello world',
      durationSeconds: 41.6,
      truncated: false,
      billing: `Transcribed 42 s of ${kind} (billed to your credit)`,
    });
    expect(transcribe.mock.calls[0]?.[0]).toMatchObject({
      fileName: `a.${ext}`,
      contentBase64: Buffer.from([1, 2, 3]).toString('base64'),
    });
  });

  it('cuts the transcript at maxChars and says so', async () => {
    const root = workspace();
    put(root, 'a.wav', Buffer.from([1]));
    const { documents } = portReturning({ text: 'x'.repeat(5000) });

    const result = await reader(root, documents)({ path: 'a.wav', maxChars: 1000 });

    expect(result).toMatchObject({ truncated: true });
    expect((result as { text: string }).text).toHaveLength(1000);
  });

  it('refuses a file over 15 MB before calling the backend', async () => {
    const root = workspace();
    put(root, 'big.mp4', Buffer.alloc(TRANSCRIBE_MAX_BYTES + 1));
    const { documents, transcribe } = portReturning();

    await expect(reader(root, documents)({ path: 'big.mp4' })).rejects.toThrow(/over 15 MB/u);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('says so when the host has no backend', async () => {
    const root = workspace();
    put(root, 'a.mp3', Buffer.from([1]));

    await expect(reader(root, undefined)({ path: 'a.mp3' })).rejects.toThrow(/no backend/u);
    await expect(reader(root, { extract: vi.fn() })({ path: 'a.mp3' })).rejects.toThrow(
      /no backend/u,
    );
  });

  it('keeps a binary file with an unknown extension refused', async () => {
    const root = workspace();
    put(root, 'a.bin', Buffer.from([0xff, 0xfe, 0, 1, 0x80]));
    const { documents, transcribe } = portReturning();

    const result = await reader(root, documents)({ path: 'a.bin' });

    expect(result).toMatchObject({ binary: true });
    expect(transcribe).not.toHaveBeenCalled();
  });
});

describe('the transcription HTTP client', () => {
  function readWith(fetcher: typeof fetch, token: string | null = 'tok') {
    const root = workspace();
    put(root, 'a.mp3', Buffer.from([1, 2]));
    return reader(root, httpDocuments(fetcher, token))({ path: 'a.mp3' });
  }

  it('posts the body with the bearer and parses the answer', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      answer(200, { text: 'hi', durationSeconds: 3, provider: 'p', truncated: false }),
    );

    const result = await readWith(fetcher);

    expect(result).toMatchObject({
      text: 'hi',
      billing: 'Transcribed 3 s of audio (billed to your credit)',
    });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('http://x/files/transcribe-text');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer tok' });
    expect(JSON.parse(String(init?.body))).toEqual({
      fileName: 'a.mp3',
      contentBase64: Buffer.from([1, 2]).toString('base64'),
    });
  });

  it('sends no Authorization header without a token, and reports a 401', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => answer(401, 'nope'));

    await expect(readWith(fetcher, null)).rejects.toThrow(/sign-in was refused \(HTTP 401\)/u);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fetcher.mock.calls[0]?.[1]?.headers)).not.toContain('Authorization');
  });

  it.each([
    [402, /Not enough credit.*do not retry/su],
    [413, /too large.*Backend said: Too big/su],
    [422, /cannot be transcribed.*Backend said: Too long/su],
  ])('answers %i once, with no retry', async (status, pattern) => {
    const message = status === 413 ? 'Too big' : 'Too long';
    const fetcher = vi.fn<typeof fetch>(async () => answer(status, { message }));

    await expect(readWith(fetcher)).rejects.toThrow(pattern);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('never retries a 503: a repeated POST could bill twice', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => answer(503, 'down'));

    await expect(readWith(fetcher)).rejects.toThrow(/HTTP 503/u);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('is wired into httpDocumentText', () => {
    expect(httpDocumentText('http://x', () => 't').transcribe).toBeTypeOf('function');
  });
});
