import { createHash } from 'node:crypto';

import {
  ARTIFACT_MIME_BY_EXTENSION,
  ARTIFACT_PREVIEW_CHARS,
  DEFAULT_ARTIFACT_MIME,
  MAX_ARTIFACT_BYTES,
} from './artifact-publication.constants';
import { redactText } from './redaction';
import { findStagedSecret } from './staged-secret-scan';

import type { PreparedArtifact } from './artifact-publication.types';

/**
 * Turns a workspace file into what may leave the machine, or refuses.
 *
 * Publishing is one-way: a hosted page cannot be recalled from whoever opened
 * it. So the scrub runs on the exact text that would be sent, in two passes.
 * The first masks what the shared redactor recognises. The second re-scans the
 * masked text with the secret detector the commit path uses, and any credential
 * that survives blocks the publication rather than being sent with a warning.
 */
export function prepareArtifact(input: { path: string; content: string }): PreparedArtifact {
  if (input.content.includes('\u0000')) {
    return { status: 'blocked', reason: 'binary', detail: 'Only text files can be published.' };
  }
  if (Buffer.byteLength(input.content, 'utf8') > MAX_ARTIFACT_BYTES) {
    return {
      status: 'blocked',
      reason: 'too-large',
      detail: `The file is larger than ${String(MAX_ARTIFACT_BYTES)} bytes.`,
    };
  }
  // Whole text, not line by line: a private key block spans lines and only
  // its BEGIN line would be masked if each line were scrubbed alone.
  const scrubbed = redactText(input.content);
  const redactedLines = input.content
    .split('\n')
    .filter((line) => redactText(line) !== line).length;
  const lines = scrubbed.split('\n');
  const leftover = findStagedSecret(lines.map((line) => `+${line}`).join('\n'));
  if (leftover !== undefined) {
    return {
      status: 'blocked',
      reason: 'secret-remains',
      detail: 'A credential is still present after scrubbing. Remove it from the file and retry.',
    };
  }
  return {
    status: 'ready',
    filename: input.path.split('/').at(-1) ?? input.path,
    mimeType: mimeFor(input.path),
    content: scrubbed,
    sha256: createHash('sha256').update(scrubbed).digest('hex'),
    bytes: Buffer.byteLength(scrubbed, 'utf8'),
    redactedLines,
    preview: scrubbed.slice(0, ARTIFACT_PREVIEW_CHARS),
    previewTruncated: scrubbed.length > ARTIFACT_PREVIEW_CHARS,
  };
}

function mimeFor(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
  return ARTIFACT_MIME_BY_EXTENSION[extension] ?? DEFAULT_ARTIFACT_MIME;
}
