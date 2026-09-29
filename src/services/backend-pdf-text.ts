import { extractPdfText } from '../backend/pdf-text-client';

import type { BackendClient } from '../backend/backend-client';
import type { PdfTextPort } from '../backend/pdf-text-client';

/**
 * PDF extraction, bound to whichever backend client is current.
 *
 * A getter for the same reason the web tool uses one: the client is replaced
 * when the user changes endpoints or signs in again, and a tool holding the old
 * one would go on sending their files to the account they left.
 */
export function backendPdfText(backend: () => BackendClient): PdfTextPort {
  return {
    extract: (input, signal) => extractPdfText(backend().filesPost, input, signal),
  };
}
