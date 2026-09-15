import { describe, expect, it } from 'vitest';

import {
  estimateImageTokens,
  imageDimensions,
  stripImageMetadata,
} from '../../src/core/image-metadata';

function png(chunks: { type: string; data: number[] }[]): Uint8Array {
  const bytes: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const chunk of chunks) {
    const length = chunk.data.length;
    bytes.push((length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff);
    for (const character of chunk.type) bytes.push(character.codePointAt(0) ?? 0);
    bytes.push(...chunk.data);
    bytes.push(0, 0, 0, 0);
  }
  return new Uint8Array(bytes);
}

function ihdr(width: number, height: number): { type: string; data: number[] } {
  return {
    type: 'IHDR',
    data: [
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
    ],
  };
}

function jpeg(
  segments: { marker: number; data: number[] }[],
  scan: number[] = [1, 2, 3],
): Uint8Array {
  const bytes: number[] = [0xff, 0xd8];
  for (const segment of segments) {
    const length = segment.data.length + 2;
    bytes.push(0xff, segment.marker, (length >> 8) & 0xff, length & 0xff, ...segment.data);
  }
  bytes.push(0xff, 0xda, 0x00, 0x02, ...scan);
  return new Uint8Array(bytes);
}

const EXIF = { marker: 0xe1, data: [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x47, 0x50, 0x53] };
const SOF0 = { marker: 0xc0, data: [8, 0x01, 0x90, 0x02, 0x80, 3] };

describe('stripImageMetadata', () => {
  it('removes the EXIF segment a phone photo carries', () => {
    const stripped = stripImageMetadata(jpeg([EXIF, SOF0]), 'image/jpeg');

    expect([...stripped]).not.toContain(0x47);
    expect(stripped.length).toBeLessThan(jpeg([EXIF, SOF0]).length);
  });

  it('keeps the frame segment, because that is the picture', () => {
    const stripped = stripImageMetadata(jpeg([EXIF, SOF0]), 'image/jpeg');

    expect(imageDimensions(stripped, 'image/jpeg')).toEqual({ width: 640, height: 400 });
  });

  it('keeps the scan data byte for byte rather than re-encoding', () => {
    const stripped = stripImageMetadata(jpeg([EXIF, SOF0], [9, 9, 9]), 'image/jpeg');

    expect([...stripped].slice(-3)).toEqual([9, 9, 9]);
  });

  it('removes PNG text and EXIF chunks', () => {
    const source = png([
      ihdr(2, 2),
      { type: 'tEXt', data: [0xab] },
      { type: 'IDAT', data: [0xcd] },
    ]);
    const stripped = stripImageMetadata(source, 'image/png');

    expect([...stripped]).not.toContain(0xab);
    expect([...stripped]).toContain(0xcd);
  });

  it('leaves a format it does not understand exactly as it was', () => {
    const webp = new Uint8Array([1, 2, 3, 4]);

    expect(stripImageMetadata(webp, 'image/webp')).toBe(webp);
  });

  it('leaves bytes alone when the header does not match the declared type', () => {
    const lying = new Uint8Array([1, 2, 3, 4]);

    expect(stripImageMetadata(lying, 'image/png')).toBe(lying);
  });
});

describe('imageDimensions', () => {
  it('reads PNG dimensions from IHDR', () => {
    expect(imageDimensions(png([ihdr(800, 600)]), 'image/png')).toEqual({
      width: 800,
      height: 600,
    });
  });

  it('reads JPEG dimensions from the frame marker', () => {
    expect(imageDimensions(jpeg([SOF0]), 'image/jpeg')).toEqual({ width: 640, height: 400 });
  });

  it('reports nothing rather than guessing for an unreadable header', () => {
    expect(imageDimensions(new Uint8Array([0, 1, 2]), 'image/png')).toBeUndefined();
    expect(imageDimensions(new Uint8Array([0, 1, 2]), 'image/gif')).toBeUndefined();
  });
});

describe('estimateImageTokens', () => {
  it('grows with area', () => {
    const small = estimateImageTokens({ width: 100, height: 100 });
    const large = estimateImageTokens({ width: 1000, height: 1000 });

    expect(large).toBeGreaterThan(small);
  });

  it('never reports a fractional token', () => {
    expect(Number.isInteger(estimateImageTokens({ width: 37, height: 11 }))).toBe(true);
  });
});
