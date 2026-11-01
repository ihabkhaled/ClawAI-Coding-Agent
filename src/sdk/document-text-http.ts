import { extractPdfText } from '../backend/pdf-text-client';
import { RuntimeHttpError } from '../headless/runtime-http-error';

import type { PdfTextPort } from '../backend/pdf-text-client';
import type { ResearchRequester } from '../backend/research-client';

/**
 * The backend's stateless `POST /files/extract-text`, called with the run's token.
 *
 * Same route and same body as the editor panel, over the same bearer the other
 * SDK backend ports use. `token` is read per call because the run signs in
 * after the toolkit is built. Nothing is stored: a read, not an upload.
 */
export function httpDocumentText(
  baseUrl: string,
  token: () => string | undefined,
  fetcher: typeof fetch = fetch,
): PdfTextPort {
  const post: ResearchRequester = async (path, schema, options) => {
    const bearer = token();
    const response = await fetcher(baseUrl + path, {
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        ...(bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` }),
      },
      body: JSON.stringify(options.body),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const text = await response.text();
    if (!response.ok) throw RuntimeHttpError.fromResponse(path, response, text);
    return schema.parse(JSON.parse(text));
  };
  return { extract: (input, signal) => extractPdfText(post, input, signal) };
}
