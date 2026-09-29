/** The largest file that can be published. Larger is a build output, not a page to share. */
export const MAX_ARTIFACT_BYTES = 1_048_576;

/** Characters of the scrubbed file shown back for review before anything leaves the machine. */
export const ARTIFACT_PREVIEW_CHARS = 4_000;

/** Types a hosted page can be. Everything else is published as plain text. */
export const ARTIFACT_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  html: 'text/html',
  htm: 'text/html',
  md: 'text/markdown',
  markdown: 'text/markdown',
  svg: 'image/svg+xml',
  json: 'application/json',
  csv: 'text/csv',
  txt: 'text/plain',
};

export const DEFAULT_ARTIFACT_MIME = 'text/plain';
