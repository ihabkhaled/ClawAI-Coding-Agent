import { readFileSync } from 'node:fs';
import path from 'node:path';

import { documentFormatOf } from '../core/document-read-format';
import { DOCUMENT_FORMAT_LABELS } from '../core/document-read-format.constants';
import { fitPdfPages } from '../core/pdf-page-budget';
import { RuntimeHttpError } from '../headless/runtime-http-error';

import { optionalInteger, requirePath } from './file-tools-args';
import {
  DOCUMENT_OLD_BACKEND_MARKER,
  DOCUMENT_READ_DEFAULT_PAGE_WINDOW,
} from './file-tools-document.constants';
import { readableTarget, readFileTool } from './file-tools-read';
import {
  FILE_READ_DEFAULT_CHARS,
  FILE_READ_MAX_CHARS,
  FILE_READ_MIN_CHARS,
} from './file-tools.constants';

import type { FileBinaryResult, FileReadResult, FileToolArguments } from './file-tools.types';
import type { PdfTextPort } from '../backend/pdf-text-client';
import type { DocumentReadFormat } from '../core/document-read-format.types';

const PAGE_LIMIT = 1_000_000;

/** What a document read returns: text by page, like the editor panel. */
export interface FileDocumentResult {
  readonly path: string;
  readonly format: DocumentReadFormat;
  readonly totalPages: number;
  readonly pages: readonly { readonly number: number; readonly text: string }[];
  readonly isScanned: boolean;
  readonly truncated: boolean;
  readonly nextPage?: number;
  readonly hint?: string;
}

/** Why the backend could not extract, in words that tell the model what to do next. */
function extractionFailure(relative: string, format: DocumentReadFormat, cause: unknown): Error {
  const label = DOCUMENT_FORMAT_LABELS[format];
  if (cause instanceof RuntimeHttpError) {
    if (cause.status === 400 && cause.detail.includes(DOCUMENT_OLD_BACKEND_MARKER)) {
      return new Error(
        `${relative} is a ${label}, but this ClawAI backend can only read PDF files and has not been updated to read other documents. Ask the user to attach the file to the message instead.`,
      );
    }
    if (cause.status === 401 || cause.status === 403) {
      return new Error(
        `${relative} is a ${label}; reading it needs the backend and the sign-in was refused (HTTP ${String(cause.status)}).`,
      );
    }
    return new Error(
      `Could not extract the text of ${relative} (${label}): the backend answered HTTP ${String(cause.status)}.`,
    );
  }
  return new Error(
    `Could not extract the text of ${relative} (${label}): the backend could not be reached. Try again, or ask the user to attach the file to the message.`,
  );
}

function pageWindow(
  args: FileToolArguments,
  format: DocumentReadFormat,
): { from: number; to: number } | undefined {
  if (format !== 'pdf') return undefined;
  const from = optionalInteger('read', args, 'startLine', 1, PAGE_LIMIT) ?? 1;
  const to =
    optionalInteger('read', args, 'endLine', 1, PAGE_LIMIT) ??
    from + DOCUMENT_READ_DEFAULT_PAGE_WINDOW - 1;
  if (to < from) {
    throw new Error(
      `workspace.file read: "endLine" ${String(to)} is before "startLine" ${String(from)}.`,
    );
  }
  return { from, to };
}

async function readDocument(
  args: FileToolArguments,
  workspace: string,
  format: DocumentReadFormat,
  documents: PdfTextPort | undefined,
  signal: AbortSignal | undefined,
): Promise<FileDocumentResult> {
  const { relative, target } = readableTarget(args, workspace);
  const label = DOCUMENT_FORMAT_LABELS[format];
  if (documents === undefined) {
    throw new Error(`${relative} is a ${label}, and this host has no backend to extract its text`);
  }
  const bytes = readFileSync(target);
  if (bytes.byteLength === 0) throw new Error(`${relative} is an empty file`);
  const pages = pageWindow(args, format);
  const maxBytes =
    optionalInteger('read', args, 'maxChars', FILE_READ_MIN_CHARS, FILE_READ_MAX_CHARS) ??
    FILE_READ_DEFAULT_CHARS;
  let extracted;
  try {
    extracted = await documents.extract(
      {
        filename: path.basename(target),
        contentBase64: bytes.toString('base64'),
        ...(pages === undefined ? {} : { pages }),
      },
      signal,
    );
  } catch (error) {
    throw extractionFailure(relative, format, error);
  }
  const window = fitPdfPages(extracted.pages, extracted.totalPages, pages?.from ?? 1, maxBytes);
  const { nextPage } = window;
  return {
    path: relative,
    format,
    totalPages: extracted.totalPages,
    pages: window.pages,
    isScanned: extracted.isScanned,
    truncated: window.truncated,
    ...(nextPage === undefined
      ? {}
      : {
          nextPage,
          hint: `Read on with startLine=${String(nextPage)} endLine=${String(Math.min(nextPage + DOCUMENT_READ_DEFAULT_PAGE_WINDOW - 1, extracted.totalPages))} (page numbers).`,
        }),
  };
}

/**
 * `workspace.file read`: PDF, Word, Excel, PowerPoint and RTF files go to the
 * backend extractor (decided on the extension, as the editor panel does);
 * anything else is read as text. The same containment and size cap apply to both.
 */
export function readWithDocuments(
  args: FileToolArguments,
  workspace: string,
  documents: PdfTextPort | undefined,
  signal?: AbortSignal,
): FileReadResult | FileBinaryResult | Promise<FileDocumentResult> {
  const format = documentFormatOf(requirePath('read', args));
  return format === undefined
    ? readFileTool(args, workspace)
    : readDocument(args, workspace, format, documents, signal);
}
