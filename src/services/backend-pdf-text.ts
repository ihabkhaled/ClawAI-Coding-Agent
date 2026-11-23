import { extractPdfText } from '../backend/pdf-text-client';
import { mediaTranscriptSchema } from '../sdk/media-transcribe-http';
import { MEDIA_TRANSCRIBE_PATH } from '../sdk/media-transcribe.constants';

import type { BackendClient } from '../backend/backend-client';
import type { PdfTextPort } from '../backend/pdf-text-client';

/**
 * PDF extraction and audio/video transcription, bound to whichever backend
 * client is current.
 *
 * A getter for the same reason the web tool uses one: the client is replaced
 * when the user changes endpoints or signs in again, and a tool holding the old
 * one would go on sending their files to the account they left.
 *
 * The transcription POST carries no retry class, so the client sends it once:
 * it is billed, and a repeat could charge twice.
 */
export function backendPdfText(backend: () => BackendClient): PdfTextPort {
  return {
    extract: (input, signal) => extractPdfText(backend().filesPost, input, signal),
    transcribe: (input, signal) =>
      backend().filesPost(MEDIA_TRANSCRIBE_PATH, mediaTranscriptSchema, {
        method: 'POST',
        body: input,
        ...(signal === undefined ? {} : { signal }),
      }),
  };
}
