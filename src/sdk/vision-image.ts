import type { VisionMimeType } from './vision-tool.types';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG chunks that carry text, EXIF or a timestamp rather than pixels. */
const PNG_METADATA_CHUNKS: ReadonlySet<string> = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

/** JPEG markers for EXIF/XMP (APP1), IPTC (APP13) and comments: not pixels. */
const JPEG_METADATA_MARKERS: ReadonlySet<number> = new Set([0xe1, 0xed, 0xfe]);

/** WebP chunks for EXIF and XMP, and the VP8X flag bits that announce them. */
const WEBP_METADATA_CHUNKS: ReadonlySet<string> = new Set(['EXIF', 'XMP ']);
const WEBP_VP8X_METADATA_FLAGS = 0x08 | 0x04;

/** The type the bytes say they are, from the file signature alone, or undefined. */
export function sniffImageType(bytes: Buffer): VisionMimeType | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return undefined;
}

/**
 * The image with text, EXIF and comment metadata removed, and with anything
 * appended after the image data cut off (a polyglot carries its second file
 * there, and a stray trailer would also keep the metadata alive), or the
 * original bytes when it cannot be walked safely. Pixels are never touched: a
 * stripped file decodes to the same image.
 */
export function withoutMetadata(bytes: Buffer, type: VisionMimeType): Buffer {
  try {
    if (type === 'image/png') return strippedPng(bytes) ?? bytes;
    if (type === 'image/jpeg') return strippedJpeg(bytes) ?? bytes;
    return strippedWebp(bytes) ?? bytes;
  } catch {
    return bytes;
  }
}

function strippedPng(bytes: Buffer): Buffer | undefined {
  const kept: Buffer[] = [bytes.subarray(0, 8)];
  let offset = 8;
  let dropped = false;
  let ended = false;
  while (offset + 12 <= bytes.length && !ended) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return undefined;
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    if (PNG_METADATA_CHUNKS.has(type)) dropped = true;
    else kept.push(bytes.subarray(offset, end));
    offset = end;
    ended = type === 'IEND';
  }
  if (!ended) return undefined;
  return dropped || offset < bytes.length ? Buffer.concat(kept) : undefined;
}

/** The offset just past the first end-of-image marker at or after `from`, or undefined. */
function endOfImage(bytes: Buffer, from: number): number | undefined {
  for (let index = from; index + 1 < bytes.length; index += 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) return index + 2;
  }
  return undefined;
}

function strippedJpeg(bytes: Buffer): Buffer | undefined {
  const kept: Buffer[] = [bytes.subarray(0, 2)];
  let offset = 2;
  let dropped = false;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xda) {
      // Start of scan: what follows is entropy-coded pixels, whose first
      // unescaped 0xFF 0xD9 is the end of the image. Anything after it is not part of it.
      const header = offset + 2 + bytes.readUInt16BE(offset + 2);
      const end = endOfImage(bytes, header) ?? bytes.length;
      kept.push(bytes.subarray(offset, end));
      return dropped || end < bytes.length ? Buffer.concat(kept) : undefined;
    }
    const end = offset + 2 + bytes.readUInt16BE(offset + 2);
    if (end > bytes.length) return undefined;
    if (JPEG_METADATA_MARKERS.has(marker)) dropped = true;
    else kept.push(bytes.subarray(offset, end));
    offset = end;
  }
  return undefined;
}

function strippedWebp(bytes: Buffer): Buffer | undefined {
  const declared = bytes.readUInt32LE(4) + 8;
  if (declared > bytes.length || declared < 12) return undefined;
  const kept: Buffer[] = [bytes.subarray(0, 12)];
  let offset = 12;
  let dropped = declared < bytes.length;
  while (offset + 8 <= declared) {
    const size = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size % 2);
    if (end > declared) return undefined;
    const name = bytes.toString('latin1', offset, offset + 4);
    if (WEBP_METADATA_CHUNKS.has(name)) dropped = true;
    else if (name === 'VP8X' && size >= 10) {
      const chunk = Buffer.from(bytes.subarray(offset, end));
      const flags = chunk.readUInt8(8);
      if ((flags & WEBP_VP8X_METADATA_FLAGS) !== 0) dropped = true;
      chunk.writeUInt8(flags & ~WEBP_VP8X_METADATA_FLAGS, 8);
      kept.push(chunk);
    } else kept.push(bytes.subarray(offset, end));
    offset = end;
  }
  if (!dropped) return undefined;
  const body = Buffer.concat(kept);
  body.writeUInt32LE(body.length - 8, 4);
  return body;
}

/** The width and height the file declares, from its header alone (nothing is decoded), or undefined. */
export function declaredSize(
  bytes: Buffer,
  type: VisionMimeType,
): { readonly width: number; readonly height: number } | undefined {
  try {
    if (type === 'image/png') return pngSize(bytes);
    if (type === 'image/jpeg') return jpegSize(bytes);
    return webpSize(bytes);
  } catch {
    return undefined;
  }
}

function pngSize(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Start-of-frame markers, which carry the size. */
const JPEG_FRAME_MARKERS: ReadonlySet<number> = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegSize(bytes: Buffer): { width: number; height: number } | undefined {
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1] ?? 0;
    if (JPEG_FRAME_MARKERS.has(marker)) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    if (marker === 0xda) return undefined;
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  return undefined;
}

function webpSize(bytes: Buffer): { width: number; height: number } | undefined {
  const kind = bytes.toString('latin1', 12, 16);
  if (kind === 'VP8X') {
    return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  }
  if (kind === 'VP8 ') {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (kind === 'VP8L') {
    const bits = bytes.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  return undefined;
}
