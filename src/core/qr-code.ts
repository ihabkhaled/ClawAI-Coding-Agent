import { interleavedCodewords, versionFor } from './qr-codewords';
import { drawFunctionPatterns, newGrid, placeCodewords } from './qr-layout';
import { applyBestMask } from './qr-mask';

import type { QrMatrix } from './qr-code.types';

/**
 * Encodes text as a QR symbol: byte mode, error-correction level M, versions
 * 1 to 10. A pairing URL is far below the version 10 limit of 213 bytes; a
 * longer text throws a RangeError so the caller can fall back to the link.
 */
export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length);
  const grid = newGrid(version);
  drawFunctionPatterns(grid);
  placeCodewords(grid, interleavedCodewords(bytes, version));
  const mask = applyBestMask(grid);
  return { version, size: grid.size, mask, modules: grid.modules };
}
