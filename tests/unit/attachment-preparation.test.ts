import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import {
  MAX_IMAGE_EDGE_PIXELS,
  MAX_IMAGE_TOKENS_PER_REQUEST,
  prepareAttachments,
} from '../../src/core/attachment-preparation';

import type { ChatAttachment } from '../../src/core/chat-attachment';

function png(width: number, height: number, extraChunks: number[] = []): Uint8Array {
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = [
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    (width >> 24) & 0xff,
    (width >> 16) & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    (height >> 24) & 0xff,
    (height >> 16) & 0xff,
    (height >> 8) & 0xff,
    height & 0xff,
    8,
    6,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ];
  return new Uint8Array([...header, ...ihdr, ...extraChunks]);
}

const TEXT_CHUNK = [0, 0, 0, 1, 0x74, 0x45, 0x58, 0x74, 0xab, 0, 0, 0, 0];

function attachment(
  bytes: Uint8Array,
  mimeType = 'image/png',
  filename = 'shot.png',
): ChatAttachment {
  const content = Buffer.from(bytes).toString('base64');
  return { clientId: 'a1', content, filename, mimeType, sizeBytes: bytes.length };
}

function document(): ChatAttachment {
  const content = Buffer.from('hello').toString('base64');
  return { clientId: 'd1', content, filename: 'notes.md', mimeType: 'text/markdown', sizeBytes: 5 };
}

describe('prepareAttachments', () => {
  it('passes a document through untouched', () => {
    const result = prepareAttachments([document()], { modelAcceptsImages: true });

    expect(result.prepared).toHaveLength(1);
    expect(result.refused).toEqual([]);
  });

  it('sends a document even to a model that cannot see', () => {
    const result = prepareAttachments([document()], { modelAcceptsImages: false });

    expect(result.prepared).toHaveLength(1);
  });

  it('refuses an image the model cannot look at, and says so', () => {
    const result = prepareAttachments([attachment(png(10, 10))], { modelAcceptsImages: false });

    expect(result.prepared).toEqual([]);
    expect(result.refused).toEqual([{ filename: 'shot.png', reason: 'model-cannot-see' }]);
  });

  it('strips metadata from an image it does send', () => {
    const withText = attachment(png(10, 10, TEXT_CHUNK));

    const result = prepareAttachments([withText], { modelAcceptsImages: true });
    const sent = result.prepared[0]?.attachment;

    expect(sent?.sizeBytes).toBeLessThan(withText.sizeBytes);
    expect([...Buffer.from(sent?.content ?? '', 'base64')]).not.toContain(0xab);
  });

  it('keeps the size honest after stripping', () => {
    const result = prepareAttachments([attachment(png(10, 10, TEXT_CHUNK))], {
      modelAcceptsImages: true,
    });
    const sent = result.prepared[0]?.attachment;

    expect(Buffer.from(sent?.content ?? '', 'base64').length).toBe(sent?.sizeBytes);
  });

  it('leaves an image with nothing to strip byte-identical', () => {
    const clean = attachment(png(10, 10));

    const result = prepareAttachments([clean], { modelAcceptsImages: true });

    expect(result.prepared[0]?.attachment.content).toBe(clean.content);
  });

  it('refuses an image larger than it will read', () => {
    const huge = attachment(png(MAX_IMAGE_EDGE_PIXELS + 1, 10));

    const result = prepareAttachments([huge], { modelAcceptsImages: true });

    expect(result.refused).toEqual([{ filename: 'shot.png', reason: 'too-large' }]);
  });

  it('refuses the image that would overrun the token budget, not the ones before it', () => {
    const big = attachment(png(2_000, 2_000));
    const result = prepareAttachments([big, big, big], { modelAcceptsImages: true });

    expect(result.prepared.length).toBeGreaterThan(0);
    expect(result.refused.some(({ reason }) => reason === 'budget-exhausted')).toBe(true);
    expect(result.estimatedImageTokens).toBeLessThanOrEqual(MAX_IMAGE_TOKENS_PER_REQUEST);
  });

  it('charges nothing for an image whose header it cannot read', () => {
    const opaque = attachment(new Uint8Array([1, 2, 3]), 'image/webp', 'odd.webp');

    const result = prepareAttachments([opaque], { modelAcceptsImages: true });

    expect(result.estimatedImageTokens).toBe(0);
    expect(result.prepared).toHaveLength(1);
  });

  it('costs the user one attachment rather than the whole message', () => {
    const result = prepareAttachments(
      [attachment(png(MAX_IMAGE_EDGE_PIXELS + 1, 10)), document()],
      {
        modelAcceptsImages: true,
      },
    );

    expect(result.prepared).toHaveLength(1);
    expect(result.refused).toHaveLength(1);
  });
});
