import { describe, expect, it, vi } from 'vitest';

import { backendPdfText } from '../../src/services/backend-pdf-text';

import type { BackendClient } from '../../src/backend/backend-client';

/** The editor's transcription port: one billed POST, no retry class, current client. */
describe('backendPdfText transcribe', () => {
  it('posts once to the transcription route with no retry class', async () => {
    const transcript = { text: 'hi', durationSeconds: 2, provider: 'GEMINI', truncated: false };
    const filesPost = vi.fn(async (..._args: unknown[]) => transcript);
    const port = backendPdfText(() => ({ filesPost }) as unknown as BackendClient);
    const signal = new AbortController().signal;

    await expect(
      port.transcribe?.({ fileName: 'a.wav', contentBase64: 'AQI=' }, signal),
    ).resolves.toEqual(transcript);

    expect(filesPost).toHaveBeenCalledTimes(1);
    expect(filesPost.mock.calls[0]?.[0]).toBe('/files/transcribe-text');
    expect(filesPost.mock.calls[0]?.[2]).toEqual({
      method: 'POST',
      body: { fileName: 'a.wav', contentBase64: 'AQI=' },
      signal,
    });
  });

  it('reads the backend through the getter on every call', async () => {
    const first = vi.fn(async () => ({}));
    const second = vi.fn(async () => ({}));
    let current = first;
    const port = backendPdfText(() => ({ filesPost: current }) as unknown as BackendClient);

    current = second;
    await port.transcribe?.({ fileName: 'a.wav', contentBase64: 'AQI=' });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
