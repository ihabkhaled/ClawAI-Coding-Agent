import { z } from 'zod';

import { RuntimeHttpError } from '../headless/runtime-http-error';

import { MEDIA_TRANSCRIBE_PATH } from './media-transcribe.constants';

import type { MediaTranscribeInput, MediaTranscribePort } from './media-transcribe.types';

/** `.loose()` like the other schemas: a field added later must not fail every read. */
export const mediaTranscriptSchema = z
  .object({
    text: z.string(),
    durationSeconds: z.number().nonnegative(),
    provider: z.string(),
    model: z.string().optional(),
    truncated: z.boolean(),
  })
  .loose();

/**
 * The backend's `POST /files/transcribe-text`, called with the run's token.
 *
 * A failure is thrown as a `RuntimeHttpError` carrying the HTTP status. There
 * is NO retry on purpose: the call is billed, and re-sending a POST whose first
 * attempt may already have been billed could charge twice. `token` is read per
 * call because the run signs in after the toolkit is built.
 */
export function httpMediaTranscribe(
  baseUrl: string,
  token: () => string | undefined,
  fetcher: typeof fetch = fetch,
): MediaTranscribePort {
  return {
    transcribe: async (body: MediaTranscribeInput, signal?: AbortSignal) => {
      const bearer = token();
      const response = await fetcher(baseUrl + MEDIA_TRANSCRIBE_PATH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` }),
        },
        body: JSON.stringify(body),
        ...(signal === undefined ? {} : { signal }),
      });
      const text = await response.text();
      if (!response.ok) throw RuntimeHttpError.fromResponse(MEDIA_TRANSCRIBE_PATH, response, text);
      return mediaTranscriptSchema.parse(JSON.parse(text));
    },
  };
}
