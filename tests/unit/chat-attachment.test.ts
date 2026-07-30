import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import {
  chatAttachmentsSchema,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  totalAttachmentBytes,
  type ChatAttachment,
} from '../../src/core/chat-attachment';

function attachment(overrides: Partial<ChatAttachment> = {}) {
  const content = Buffer.from('claw').toString('base64');
  return {
    clientId: '1e27591c-45a6-4146-9d73-c74cd1685cc1',
    content,
    filename: 'claw.png',
    mimeType: 'image/png',
    sizeBytes: 4,
    ...overrides,
  };
}

describe('chatAttachmentsSchema', () => {
  it('accepts screenshots, source files, and videos with exact base64 sizes', () => {
    expect(
      chatAttachmentsSchema.parse([
        attachment(),
        attachment({
          clientId: 'b15edcc1-d952-4bc5-bd9d-aa65a94aa64c',
          filename: 'loop.ts',
          mimeType: 'application/typescript',
        }),
        attachment({
          clientId: 'd1fb2f88-382e-4d4c-a819-045ac376d57b',
          filename: 'repro.mp4',
          mimeType: 'video/mp4',
        }),
      ]),
    ).toHaveLength(3);
    expect(totalAttachmentBytes([attachment(), attachment()])).toBe(8);
    expect(totalAttachmentBytes(undefined)).toBe(0);
  });

  it('rejects malformed payloads, path-bearing names, and size claims that do not match', () => {
    expect(() => chatAttachmentsSchema.parse([attachment({ content: 'not-base64' })])).toThrow();
    expect(() =>
      chatAttachmentsSchema.parse([attachment({ filename: '../secret.txt' })]),
    ).toThrow();
    expect(() =>
      chatAttachmentsSchema.parse([attachment({ filename: 'unsafe\u0001name.txt' })]),
    ).toThrow();
    expect(() => chatAttachmentsSchema.parse([attachment({ sizeBytes: 5 })])).toThrow();
  });

  it('rejects oversized files and more than ten attachments', () => {
    const oversized = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 1);
    expect(() =>
      chatAttachmentsSchema.parse([
        attachment({
          content: oversized.toString('base64'),
          sizeBytes: oversized.byteLength,
        }),
      ]),
    ).toThrow();
    expect(() =>
      chatAttachmentsSchema.parse(
        Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, index) =>
          attachment({ clientId: `attachment-${String(index)}` }),
        ),
      ),
    ).toThrow();
  });

  it('rejects an aggregate payload above the request byte limit', () => {
    const content = Buffer.alloc(20_000_000, 1).toString('base64');
    const result = chatAttachmentsSchema.safeParse(
      Array.from({ length: 3 }, (_, index) =>
        attachment({
          clientId: `large-${String(index)}`,
          content,
          sizeBytes: 20_000_000,
        }),
      ),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ message: 'Attachments exceed the total request limit.' }),
    );
  });

  it('matches the backend video allowlist and rejects unsupported legacy document types', () => {
    expect(
      chatAttachmentsSchema.parse([
        attachment({ filename: 'capture.avi', mimeType: 'video/x-msvideo' }),
        attachment({ clientId: 'video-2', filename: 'capture.mov', mimeType: 'video/mov' }),
        attachment({ clientId: 'video-3', filename: 'capture.avi', mimeType: 'video/avi' }),
      ]),
    ).toHaveLength(3);
    expect(() =>
      chatAttachmentsSchema.parse([
        attachment({ filename: 'capture.mkv', mimeType: 'video/x-matroska' }),
      ]),
    ).toThrow();
    expect(() =>
      chatAttachmentsSchema.parse([attachment({ filename: 'capture.ogv', mimeType: 'video/ogg' })]),
    ).toThrow();
    expect(() =>
      chatAttachmentsSchema.parse([
        attachment({ filename: 'legacy.doc', mimeType: 'application/msword' }),
      ]),
    ).toThrow();
  });
});
