import {
  DOCUMENT_READ_FORMATS,
  UNREADABLE_MEDIA_EXTENSIONS,
} from './document-read-format.constants';

import type { DocumentReadFormat, UnreadableMediaKind } from './document-read-format.types';

function extensionOf(path: string): string {
  const name = path.split(/[\\/]/u).pop() ?? path;
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * The document format a read should send to the extractor, decided on the
 * extension and not on whether the bytes happen to be UTF-8: an uncompressed
 * PDF can be valid UTF-8 and would otherwise come back as raw source.
 */
export function documentFormatOf(path: string): DocumentReadFormat | undefined {
  const extension = extensionOf(path);
  return DOCUMENT_READ_FORMATS.find((format) => format === extension);
}

/** What an image, audio or video file is, when a text read cannot return it. */
export function unreadableMediaKind(path: string): UnreadableMediaKind | undefined {
  const extension = extensionOf(path);
  const kinds = Object.keys(UNREADABLE_MEDIA_EXTENSIONS) as UnreadableMediaKind[];
  return kinds.find((kind) =>
    (UNREADABLE_MEDIA_EXTENSIONS[kind] as readonly string[]).includes(extension),
  );
}

/** Why a binary file cannot be read as text, in the words that help most. */
export function unreadableReadMessage(path: string): string {
  const kind = unreadableMediaKind(path);
  return kind === undefined
    ? `${path} is not UTF-8 text and cannot be read`
    : unreadableMediaMessage(path, kind);
}

/**
 * Said instead of "not UTF-8 text": that is true and useless. A model told only
 * that keeps probing the file, so this names what it is and what to do.
 */
export function unreadableMediaMessage(path: string, kind: UnreadableMediaKind): string {
  return `${path} is ${kind === 'video' ? 'a' : 'an'} ${kind} file, which a text read cannot return. Ask the user to attach it to the message so a model that can ${kind === 'image' ? 'see' : kind === 'audio' ? 'listen' : 'watch'} it receives it.`;
}
