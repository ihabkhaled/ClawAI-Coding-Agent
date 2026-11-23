import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { abortableSleep } from '../backend/backend-retry';
import { TRANSCRIBE_MAX_BYTES } from '../core/document-read-format.constants';
import { containedPath } from '../core/workspace-containment';
import { RuntimeHttpError } from '../headless/runtime-http-error';

import { optionalInteger, requirePath } from './file-tools-args';
import {
  FILE_READ_DEFAULT_CHARS,
  FILE_READ_MAX_CHARS,
  FILE_READ_MIN_CHARS,
} from './file-tools.constants';
import {
  MEDIA_BILLING_NOTE,
  TRANSCRIBE_BUSY_CODE,
  TRANSCRIBE_BUSY_RETRIES,
  TRANSCRIBE_BUSY_WAIT_MS,
} from './media-transcribe.constants';

import type { FileToolArguments } from './file-tools.types';
import type { MediaTranscribeInput, MediaTranscript } from './media-transcribe.types';
import type { PdfTextPort } from '../backend/pdf-text-client';
import type { TranscribableMediaKind } from '../core/document-read-format.types';

/** What a transcription read returns: the words, and what it cost in plain language. */
export interface FileTranscriptResult {
  readonly path: string;
  readonly kind: TranscribableMediaKind;
  readonly text: string;
  readonly durationSeconds: number;
  readonly provider: string;
  readonly model?: string;
  readonly truncated: boolean;
  /** Shown to the user: "Transcribed 42 s of audio (billed to your credit)". */
  readonly billing: string;
}

type Transcribe = NonNullable<PdfTextPort['transcribe']>;

const MEGABYTE = 1024 * 1024;

/** The backend's `message`, when the body is a JSON error, else the raw text. */
function backendMessage(detail: string): string {
  try {
    const message = (JSON.parse(detail) as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) {
      return message.filter((entry): entry is string => typeof entry === 'string').join('; ');
    }
  } catch {
    // not JSON: the raw text is the message
  }
  return detail;
}

/** The HTTP status of a refusal from the headless or the editor client alike. */
function refusalStatus(cause: unknown): number | undefined {
  if (!(cause instanceof Error)) return undefined;
  const status = (cause as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * The file service's "every slot is in use" answer: refused before anything is
 * billed. The headless client keeps the body's code; the editor client folds it
 * into the message as "<reason> (<code>)".
 */
function isBusy(cause: unknown): boolean {
  if (refusalStatus(cause) !== 429) return false;
  return (
    (cause as { code?: unknown }).code === TRANSCRIBE_BUSY_CODE ||
    (cause as Error).message.includes(`(${TRANSCRIBE_BUSY_CODE})`)
  );
}

/** Why a transcription failed, in words that tell the model what to do next. */
function transcribeFailure(relative: string, cause: unknown): Error {
  const status = refusalStatus(cause);
  if (status === undefined) {
    return new Error(
      `Could not transcribe ${relative}: the backend could not be reached. Try again, or ask the user to attach the file to the message.`,
    );
  }
  const raw = cause instanceof RuntimeHttpError ? cause.detail : (cause as Error).message;
  const said = backendMessage(raw).trim();
  const suffix = said === '' ? '' : ` Backend said: ${said}`;
  switch (status) {
    case 401:
    case 403:
      return new Error(
        `Transcribing ${relative} needs the backend and the sign-in was refused (HTTP ${String(status)}).`,
      );
    case 402:
      return new Error(
        `Not enough credit to transcribe ${relative}. Nothing was billed. Ask the user to top up their credit; do not retry.${suffix}`,
      );
    case 413:
      return new Error(`${relative} is too large for the backend to transcribe.${suffix}`);
    case 422:
      return new Error(
        `${relative} cannot be transcribed: unsupported audio/video or longer than the allowed duration.${suffix}`,
      );
    case 429:
      return new Error(
        `The backend is busy and did not transcribe ${relative}. Nothing was billed. Try again in a minute.${suffix}`,
      );
    default:
      return new Error(
        `Could not transcribe ${relative}: the backend answered HTTP ${String(status)}.`,
      );
  }
}

/**
 * Sends the file, waiting out a busy file service a bounded number of times.
 *
 * Only the BUSY refusal is re-sent: the file service answers it before any
 * provider call, so nothing was billed. Every other failure, a 503 included,
 * may follow a billed call and is never repeated.
 */
async function transcribeWhenFree(
  transcribe: Transcribe,
  input: MediaTranscribeInput,
  signal: AbortSignal | undefined,
): Promise<MediaTranscript> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await transcribe(input, signal);
    } catch (error) {
      if (!isBusy(error) || attempt >= TRANSCRIBE_BUSY_RETRIES) throw error;
      await abortableSleep(TRANSCRIBE_BUSY_WAIT_MS, signal);
    }
  }
}

/** Refuses an empty or over-cap file before anything is sent. */
function assertTranscribableSize(
  relative: string,
  size: number,
  kind: TranscribableMediaKind,
): void {
  if (size === 0) throw new Error(`${relative} is an empty file`);
  if (size > TRANSCRIBE_MAX_BYTES) {
    throw new Error(
      `${relative} is ${(size / MEGABYTE).toFixed(1)} MB; ${kind} files over ${String(TRANSCRIBE_MAX_BYTES / MEGABYTE)} MB are not transcribed. Ask the user for a shorter clip.`,
    );
  }
}

/** The transcriber, or the reason this host cannot transcribe. */
function requireTranscriber(
  relative: string,
  kind: TranscribableMediaKind,
  media: Pick<PdfTextPort, 'transcribe'> | undefined,
): Transcribe {
  if (media?.transcribe === undefined) {
    throw new Error(
      `${relative} is ${kind === 'audio' ? 'an' : 'a'} ${kind} file, and this host has no backend to transcribe it`,
    );
  }
  return media.transcribe;
}

/**
 * One audio or video file's bytes as a transcript, through the billed backend
 * route. The headless tool and the editor's file tool both read media through
 * here, so they refuse, retry and bill the same way.
 */
export async function transcribeMediaBytes(
  relative: string,
  kind: TranscribableMediaKind,
  bytes: Uint8Array,
  media: Pick<PdfTextPort, 'transcribe'> | undefined,
  maxChars: number,
  signal: AbortSignal | undefined,
): Promise<FileTranscriptResult> {
  const transcribe = requireTranscriber(relative, kind, media);
  assertTranscribableSize(relative, bytes.byteLength, kind);
  let transcript: MediaTranscript;
  try {
    transcript = await transcribeWhenFree(
      transcribe,
      { fileName: path.basename(relative), contentBase64: Buffer.from(bytes).toString('base64') },
      signal,
    );
  } catch (error) {
    throw transcribeFailure(relative, error);
  }
  const cut = transcript.text.length > maxChars;
  return {
    path: relative,
    kind,
    text: cut ? transcript.text.slice(0, maxChars) : transcript.text,
    durationSeconds: transcript.durationSeconds,
    provider: transcript.provider,
    ...(transcript.model === undefined ? {} : { model: transcript.model }),
    truncated: cut || transcript.truncated,
    billing: `Transcribed ${String(Math.round(transcript.durationSeconds))} s of ${kind} (${MEDIA_BILLING_NOTE})`,
  };
}

/** Refuses a missing, non-regular, empty or over-cap file before it is read. */
function assertTranscribable(relative: string, target: string, kind: TranscribableMediaKind): void {
  const stats = existsSync(target) ? statSync(target) : undefined;
  if (stats === undefined) {
    throw new Error(`workspace.file read: "path" ${relative} does not exist.`);
  }
  if (!stats.isFile()) {
    throw new Error(`workspace.file read: "path" ${relative} is not a regular file.`);
  }
  assertTranscribableSize(relative, stats.size, kind);
}

/** Reads one audio or video file from disk as a transcript (the headless tool). */
export async function readMedia(
  args: FileToolArguments,
  workspace: string,
  kind: TranscribableMediaKind,
  media: Pick<PdfTextPort, 'transcribe'> | undefined,
  signal: AbortSignal | undefined,
): Promise<FileTranscriptResult> {
  const relative = requirePath('read', args);
  const target = containedPath(workspace, relative);
  requireTranscriber(relative, kind, media);
  // Checked on the stat, before the read, so a 2 GB video is never loaded.
  assertTranscribable(relative, target, kind);
  const maxChars =
    optionalInteger('read', args, 'maxChars', FILE_READ_MIN_CHARS, FILE_READ_MAX_CHARS) ??
    FILE_READ_DEFAULT_CHARS;
  return transcribeMediaBytes(relative, kind, readFileSync(target), media, maxChars, signal);
}
