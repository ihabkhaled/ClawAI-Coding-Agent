import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { sniffImageType, withoutMetadata } from '../../src/sdk/vision-image';
import {
  jpegWithMetadata,
  pngChunk,
  pngPixelData,
  redRectanglePng,
  webpStub,
} from '../helpers/png-fixture';

describe('sniffImageType', () => {
  it('names png, jpeg and webp by their signatures', () => {
    expect(sniffImageType(redRectanglePng())).toBe('image/png');
    expect(sniffImageType(jpegWithMetadata().bytes)).toBe('image/jpeg');
    expect(sniffImageType(webpStub())).toBe('image/webp');
  });

  it('refuses everything else, including text and short files', () => {
    expect(
      sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeUndefined();
    expect(sniffImageType(Buffer.from('GIF89a'))).toBeUndefined();
    expect(sniffImageType(Buffer.from([0x89, 0x50]))).toBeUndefined();
    expect(sniffImageType(Buffer.alloc(0))).toBeUndefined();
  });
});

describe('withoutMetadata', () => {
  it('drops png text and EXIF chunks and leaves the pixels byte for byte', () => {
    const noisy = redRectanglePng([
      pngChunk('tEXt', Buffer.from('Software\0Playwright /home/ihab')),
      pngChunk('eXIf', Buffer.from('gps')),
      pngChunk('tIME', Buffer.alloc(7)),
    ]);
    const clean = withoutMetadata(noisy, 'image/png');
    expect(clean.length).toBeLessThan(noisy.length);
    expect(clean.toString('latin1')).not.toContain('Playwright');
    expect(pngPixelData(clean).equals(pngPixelData(noisy))).toBe(true);
    expect(inflateSync(pngPixelData(clean)).length).toBe(80 * (120 * 3 + 1));
  });

  it('returns the very same bytes when there is nothing to remove', () => {
    const plain = redRectanglePng();
    expect(withoutMetadata(plain, 'image/png')).toBe(plain);
  });

  it('removes jpeg EXIF and comments before the scan', () => {
    const { bytes, clean } = jpegWithMetadata();
    const result = withoutMetadata(bytes, 'image/jpeg');
    expect(result.equals(clean)).toBe(true);
    expect(result.toString('latin1')).not.toContain('GPS');
  });

  it('keeps a damaged file as it is rather than guessing', () => {
    const truncated = redRectanglePng([pngChunk('tEXt', Buffer.from('a\0b'))]).subarray(0, 60);
    expect(withoutMetadata(truncated, 'image/png')).toBe(truncated);
    const brokenJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2, 3]);
    expect(withoutMetadata(brokenJpeg, 'image/jpeg')).toBe(brokenJpeg);
  });

  it('leaves webp alone', () => {
    const stub = webpStub();
    expect(withoutMetadata(stub, 'image/webp')).toBe(stub);
  });
});
