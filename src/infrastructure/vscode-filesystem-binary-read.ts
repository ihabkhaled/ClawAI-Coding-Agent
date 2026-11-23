import { documentFormatOf, transcribableMediaKind } from '../core/document-read-format';
import { DOCUMENT_FORMAT_LABELS } from '../core/document-read-format.constants';
import { fitPdfPages } from '../core/pdf-page-budget';
import { transcribeMediaBytes } from '../sdk/file-tools-media';
import { FILE_READ_DEFAULT_CHARS } from '../sdk/file-tools.constants';

import type { PdfTextPort } from '../backend/pdf-text-client';
import type { DocumentReadFormat } from '../core/document-read-format.types';
import type { RuntimeToolExecutionOutput } from '../services/runtime-tool-dispatcher';

// Pages read when a PDF is read with no range. The backend refuses a range
// wider than 100 pages; twenty is enough to answer most questions about a
// document and small enough that the text usually fits in one result.
const PDF_DEFAULT_PAGE_WINDOW = 20;

/** The read arguments a document or media read needs. */
export interface BinaryReadInput {
  readonly path: string;
  readonly pages?: { from: number; to: number } | undefined;
  readonly maxBytes: number;
}

/**
 * A document or an audio/video file read through the backend, or `undefined`
 * when the path is neither and the caller reads it as text.
 *
 * Decided on the extension, not on decoding failing: an uncompressed PDF can be
 * valid UTF-8, and would otherwise come back as raw PDF source.
 */
export async function readDocumentOrMedia(
  port: PdfTextPort | undefined,
  input: BinaryReadInput,
  bytes: Uint8Array | undefined,
  signal: AbortSignal | undefined,
): Promise<RuntimeToolExecutionOutput | undefined> {
  const format = documentFormatOf(input.path);
  if (format !== undefined) {
    return readDocument(port, input.path, format, bytes, input.pages, input.maxBytes);
  }
  // Audio and video come back as a billed transcript, exactly as in the headless tool.
  const mediaKind = transcribableMediaKind(input.path);
  if (mediaKind === undefined) return undefined;
  const transcript = await transcribeMediaBytes(
    input.path,
    mediaKind,
    bytes ?? new Uint8Array(),
    port,
    FILE_READ_DEFAULT_CHARS,
    signal,
  );
  return { structured: { ...transcript } };
}

/**
 * A workspace document (PDF, Word, Excel, PowerPoint or RTF), as text.
 *
 * The bytes go to the backend's extractor, which keeps nothing: this is a
 * read, not an upload, so the file never lands in the user's file list.
 *
 * Pages are delivered whole and in order until the byte budget is spent,
 * then `nextPage` says where to resume — the page-shaped twin of the text
 * read's `nextStartLine`. Cutting a page mid-way would hand the model half a
 * sentence it cannot tell is half. Only a PDF has pages; the other formats
 * come back as one, so no range is sent for them.
 */
async function readDocument(
  port: PdfTextPort | undefined,
  path: string,
  format: DocumentReadFormat,
  bytes: Uint8Array | undefined,
  requested: { from: number; to: number } | undefined,
  maxBytes: number,
): Promise<RuntimeToolExecutionOutput> {
  if (port === undefined) {
    throw new Error(
      `${path} is a ${DOCUMENT_FORMAT_LABELS[format]}, and this host has no backend to extract its text`,
    );
  }
  if (bytes === undefined || bytes.byteLength === 0) {
    throw new Error(`${path} is an empty file`);
  }
  const pages =
    format === 'pdf' ? (requested ?? { from: 1, to: PDF_DEFAULT_PAGE_WINDOW }) : undefined;
  const extracted = await port.extract({
    filename: path.split('/').pop() ?? path,
    contentBase64: Buffer.from(bytes).toString('base64'),
    ...(pages === undefined ? {} : { pages }),
  });

  const window = fitPdfPages(extracted.pages, extracted.totalPages, pages?.from ?? 1, maxBytes);
  const nextPage = window.nextPage;
  return {
    structured: {
      path,
      format,
      totalPages: extracted.totalPages,
      pages: window.pages,
      // A scanned page has no text layer however often it is read. Saying
      // so stops the model retrying a page that will always come back empty.
      isScanned: extracted.isScanned,
      // Kept apart on purpose — see fitPdfPages.
      truncated: window.truncated,
      ...(nextPage === undefined
        ? {}
        : {
            nextPage,
            hint: `Read on with pages {"from":${String(nextPage)},"to":${String(Math.min(nextPage + PDF_DEFAULT_PAGE_WINDOW - 1, extracted.totalPages))}}`,
          }),
    },
  };
}
