import type { ImageSize } from './image-metadata.types';

/** JPEG markers that carry metadata rather than image data. */
const JPEG_METADATA_MARKERS = new Set([
  0xe1, // APP1 — EXIF, and where GPS coordinates live.
  0xe2, // APP2 — ICC and Flashpix.
  0xed, // APP13 — Photoshop IRB, which carries IPTC.
  0xee, // APP14 — Adobe.
  0xfe, // COM — free-form comment.
]);

/** PNG chunks that carry metadata rather than image data. */
const PNG_METADATA_CHUNKS = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  );
}

/**
 * A JPEG with its metadata segments removed.
 *
 * Segment-level surgery, not re-encoding: the scan data is copied through
 * untouched, so the image a person sees is byte-for-byte what they attached
 * minus the parts that describe them rather than the picture. Re-encoding
 * would change the pixels to remove something that was never in the pixels.
 */
function stripJpeg(bytes: Uint8Array): Uint8Array {
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1] ?? 0;
    // Start of scan: everything from here is image data.
    if (marker === 0xda) {
      kept.push(bytes.subarray(offset));
      offset = bytes.length;
      break;
    }
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) break;
    if (!JPEG_METADATA_MARKERS.has(marker)) kept.push(bytes.subarray(offset, end));
    offset = end;
  }
  if (offset < bytes.length) kept.push(bytes.subarray(offset));
  return concat(kept);
}

/** A PNG with its metadata chunks removed, image chunks copied through. */
function stripPng(bytes: Uint8Array): Uint8Array {
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const end = offset + 12 + length;
    if (length < 0 || end > bytes.length) break;
    const type = String.fromCodePoint(...bytes.subarray(offset + 4, offset + 8));
    if (!PNG_METADATA_CHUNKS.has(type)) kept.push(bytes.subarray(offset, end));
    offset = end;
  }
  return concat(kept);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    merged.set(part, at);
    at += part.length;
  }
  return merged;
}

/**
 * The image with anything that describes the photographer removed.
 *
 * EXIF is the reason this exists. A screenshot is usually harmless; a photo
 * taken on a phone carries GPS coordinates, a device serial and a timestamp,
 * and attaching one to a chat sends all three to a model provider. Nobody
 * means to do that, so it is not offered as an option.
 *
 * A format this does not understand is returned unchanged rather than
 * mangled: refusing to guess is what keeps a working attachment working.
 */
export function stripImageMetadata(bytes: Uint8Array, mimeType: string): Uint8Array {
  if (mimeType === 'image/jpeg' && isJpeg(bytes)) return stripJpeg(bytes);
  if (mimeType === 'image/png' && isPng(bytes)) return stripPng(bytes);
  return bytes;
}

/** PNG puts width and height in the IHDR chunk, at a fixed offset. */
function pngDimensions(bytes: Uint8Array): ImageSize | undefined {
  if (bytes.length < 24) return undefined;
  return { width: readUint32(bytes, 16), height: readUint32(bytes, 20) };
}

/** JPEG hides them in whichever start-of-frame marker the encoder chose. */
function jpegDimensions(bytes: Uint8Array): ImageSize | undefined {
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1] ?? 0;
    if (isFrameMarker(marker)) {
      return {
        height: ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0),
        width: ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0),
      };
    }
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    if (length < 2) return undefined;
    offset += 2 + length;
  }
  return undefined;
}

/** 0xc4, 0xc8 and 0xcc sit in the same range but carry tables, not a frame. */
function isFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

/** The pixel dimensions read from the header, or nothing if they cannot be read. */
export function imageDimensions(bytes: Uint8Array, mimeType: string): ImageSize | undefined {
  if (mimeType === 'image/png' && isPng(bytes)) return pngDimensions(bytes);
  if (mimeType === 'image/jpeg' && isJpeg(bytes)) return jpegDimensions(bytes);
  return undefined;
}

/**
 * Roughly what an image costs to look at.
 *
 * Deliberately approximate. The exact number differs per provider and changes
 * without notice, so a precise-looking figure would be a lie with decimals.
 * This is enough to answer the only question being asked: is this one image
 * about to eat the whole budget.
 */
export function estimateImageTokens(size: ImageSize): number {
  return Math.ceil((size.width * size.height) / 750);
}
