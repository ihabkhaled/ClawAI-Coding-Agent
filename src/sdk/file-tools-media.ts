import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { TRANSCRIBE_MAX_BYTES } from '../core/document-read-format.constants';
import { containedPath } from '../core/workspace-containment';
import { RuntimeHttpError } from '../headless/runtime-http-error';

import { optionalInteger, requirePath } from './file-tools-args';
import {
  FILE_READ_DEFAULT_CHARS,
  FILE_READ_MAX_CHARS,
  FILE_READ_MIN_CHARS,
} from './file-tools.constants';
import { MEDIA_BILLING_NOTE } from './media-transcribe.constants';

import type { FileToolArguments } from './file-tools.types';
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

/** Why a transcription failed, in words that tell the model what to do next. */
function transcribeFailure(relative: string, cause: unknown): Error {
  if (!(cause instanceof RuntimeHttpError)) {
    return new Error(
      `Could not transcribe ${relative}: the backend could not be reached. Try again, or ask the user to attach the file to the message.`,
    );
  }
  const said = backendMessage(cause.detail).trim();
  const suffix = said === '' ? '' : ` Backend said: ${said}`;
  switch (cause.status) {
    case 401:
    case 403:
      return new Error(
        `Transcribing ${relative} needs the backend and the sign-in was refused (HTTP ${String(cause.status)}).`,
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
    default:
      return new Error(
        `Could not transcribe ${relative}: the backend answered HTTP ${String(cause.status)}.`,
      );
  }
}

/** Refuses a missing, non-regular, empty or over-cap file before anything is sent. */
function assertTranscribable(relative: string, target: string, kind: TranscribableMediaKind): void {
  const stats = existsSync(target) ? statSync(target) : undefined;
  if (stats === undefined) {
    throw new Error(`workspace.file read: "path" ${relative} does not exist.`);
  }
  if (!stats.isFile()) {
    throw new Error(`workspace.file read: "path" ${relative} is not a regular file.`);
  }
  if (stats.size === 0) throw new Error(`${relative} is an empty file`);
  if (stats.size > TRANSCRIBE_MAX_BYTES) {
    throw new Error(
      `${relative} is ${(stats.size / MEGABYTE).toFixed(1)} MB; ${kind} files over ${String(TRANSCRIBE_MAX_BYTES / MEGABYTE)} MB are not transcribed. Ask the user for a shorter clip.`,
    );
  }
}

/** Reads one audio or video file as a transcript through the billed backend route. */
export async function readMedia(
  args: FileToolArguments,
  workspace: string,
  kind: TranscribableMediaKind,
  media: Pick<PdfTextPort, 'transcribe'> | undefined,
  signal: AbortSignal | undefined,
): Promise<FileTranscriptResult> {
  const relative = requirePath('read', args);
  const target = containedPath(workspace, relative);
  const article = kind === 'audio' ? 'an' : 'a';
  if (media?.transcribe === undefined) {
    throw new Error(
      `${relative} is ${article} ${kind} file, and this host has no backend to transcribe it`,
    );
  }
  assertTranscribable(relative, target, kind);
  const maxChars =
    optionalInteger('read', args, 'maxChars', FILE_READ_MIN_CHARS, FILE_READ_MAX_CHARS) ??
    FILE_READ_DEFAULT_CHARS;
  let transcript;
  try {
    transcript = await media.transcribe(
      { fileName: path.basename(target), contentBase64: readFileSync(target).toString('base64') },
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
