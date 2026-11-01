import type {
  DOCUMENT_READ_FORMATS,
  UNREADABLE_MEDIA_EXTENSIONS,
} from './document-read-format.constants';

export type DocumentReadFormat = (typeof DOCUMENT_READ_FORMATS)[number];

export type UnreadableMediaKind = keyof typeof UNREADABLE_MEDIA_EXTENSIONS;
