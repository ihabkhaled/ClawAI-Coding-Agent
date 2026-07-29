import { Buffer } from 'node:buffer';

import { z } from 'zod';

export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL_BYTES = 10 * 1024 * 1024;

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'application/graphql',
  'application/javascript',
  'application/json',
  'application/ld+json',
  'application/octet-stream',
  'application/pdf',
  'application/rtf',
  'application/sql',
  'application/toml',
  'application/typescript',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/x-httpd-php',
  'application/x-latex',
  'application/x-ndjson',
  'application/x-perl',
  'application/x-python',
  'application/x-ruby',
  'application/x-sh',
  'application/x-tex',
  'application/x-yaml',
  'application/x-zip-compressed',
  'application/xml',
  'application/yaml',
  'application/zip',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
  'text/css',
  'text/csv',
  'text/html',
  'text/javascript',
  'text/markdown',
  'text/plain',
  'text/rtf',
  'text/tab-separated-values',
  'text/x-c',
  'text/x-c++',
  'text/x-diff',
  'text/x-go',
  'text/x-java-source',
  'text/x-log',
  'text/x-python',
  'text/x-ruby',
  'text/x-rust',
  'text/x-shellscript',
  'text/x-sql',
  'text/x-toml',
  'text/x-yaml',
  'text/xml',
  'video/mp4',
  'video/mpeg',
  'video/avi',
  'video/mov',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo',
]);

function isBase64CodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 48 && codePoint <= 57) ||
    (codePoint >= 65 && codePoint <= 90) ||
    (codePoint >= 97 && codePoint <= 122) ||
    codePoint === 43 ||
    codePoint === 47
  );
}

function hasCanonicalBase64Alphabet(content: string): boolean {
  if (content.length === 0 || content.length % 4 !== 0) {
    return false;
  }
  const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0;
  const contentLength = content.length - padding;
  for (let index = 0; index < contentLength; index += 1) {
    if (!isBase64CodePoint(content.charCodeAt(index))) {
      return false;
    }
  }
  return contentLength > 0;
}

function decodedByteLength(content: string): number | null {
  if (!hasCanonicalBase64Alphabet(content)) {
    return null;
  }
  const decoded = Buffer.from(content, 'base64');
  return decoded.toString('base64') === content ? decoded.byteLength : null;
}

function isSafeFilename(value: string): boolean {
  if (value.includes('/') || value.includes('\\')) {
    return false;
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 32 || codePoint === 127) {
      return false;
    }
  }
  return true;
}

export const chatAttachmentSchema = z
  .object({
    clientId: z.string().trim().min(1).max(100),
    content: z
      .string()
      .min(1)
      .max(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 4),
    filename: z.string().trim().min(1).max(255).refine(isSafeFilename),
    mimeType: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => ALLOWED_ATTACHMENT_MIME_TYPES.has(value), {
        message: 'This file type is not supported.',
      }),
    sizeBytes: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
  })
  .superRefine((attachment, context) => {
    const decodedLength = decodedByteLength(attachment.content);
    if (decodedLength === null || decodedLength !== attachment.sizeBytes) {
      context.addIssue({
        code: 'custom',
        message: 'Attachment size does not match its encoded content.',
        path: ['content'],
      });
    }
  });

export const chatAttachmentsSchema = z
  .array(chatAttachmentSchema)
  .max(MAX_ATTACHMENTS)
  .superRefine((attachments, context) => {
    const total = attachments.reduce((sum, attachment) => sum + attachment.sizeBytes, 0);
    if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
      context.addIssue({
        code: 'custom',
        message: 'Attachments exceed the total request limit.',
        path: [],
      });
    }
  });

export type ChatAttachment = z.infer<typeof chatAttachmentSchema>;

export function totalAttachmentBytes(attachments: readonly ChatAttachment[] | undefined): number {
  return attachments?.reduce((total, attachment) => total + attachment.sizeBytes, 0) ?? 0;
}
