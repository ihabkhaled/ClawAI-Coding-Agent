import { z } from 'zod';

import type { ResearchRequester } from './research-client';

/**
 * What `POST /files/extract-text` returns.
 *
 * `.loose()` like the research schemas: a field the backend adds later must not
 * make every PDF read fail validation on a client that has not been updated.
 */
export const extractTextResultSchema = z
  .object({
    text: z.string(),
    pages: z.array(z.object({ number: z.number().int(), text: z.string() }).loose()),
    totalPages: z.number().int().nonnegative(),
    isScanned: z.boolean(),
  })
  .loose();

export type ExtractTextResult = z.infer<typeof extractTextResultSchema>;

/**
 * Text from a PDF the user already has, by page.
 *
 * The backend parses and keeps nothing: this is a read, not an upload, so a
 * repository file never lands in the user's file list or storage.
 */
export async function extractPdfText(
  request: ResearchRequester,
  body: {
    filename: string;
    contentBase64: string;
    pages?: { from: number; to: number } | undefined;
  },
  signal?: AbortSignal,
): Promise<ExtractTextResult> {
  return request('/files/extract-text', extractTextResultSchema, {
    method: 'POST',
    body,
    ...(signal === undefined ? {} : { signal }),
  });
}

/** The one call the file tool needs to read a PDF. */
export interface PdfTextPort {
  extract(
    input: {
      filename: string;
      contentBase64: string;
      pages?: { from: number; to: number } | undefined;
    },
    signal?: AbortSignal,
  ): Promise<ExtractTextResult>;
}
