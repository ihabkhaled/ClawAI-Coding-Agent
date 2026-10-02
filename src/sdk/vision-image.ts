import type { VisionMimeType } from './vision-tool.types';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG chunks that carry text, EXIF or a timestamp rather than pixels. */
const PNG_METADATA_CHUNKS: ReadonlySet<string> = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

/** JPEG markers for EXIF/XMP (APP1), IPTC (APP13) and comments: not pixels. */
const JPEG_METADATA_MARKERS: ReadonlySet<number> = new Set([0xe1, 0xed, 0xfe]);

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
 * The image with text, EXIF and comment metadata removed, or the original bytes
 * when it cannot be walked safely. Pixels are never touched: a stripped file
 * decodes to the same image. WebP is returned as is.
 */
export function withoutMetadata(bytes: Buffer, type: VisionMimeType): Buffer {
  try {
    if (type === 'image/png') return strippedPng(bytes) ?? bytes;
    if (type === 'image/jpeg') return strippedJpeg(bytes) ?? bytes;
  } catch {
    return bytes;
  }
  return bytes;
}

function strippedPng(bytes: Buffer): Buffer | undefined {
  const kept: Buffer[] = [bytes.subarray(0, 8)];
  let offset = 8;
  let dropped = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return undefined;
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    if (PNG_METADATA_CHUNKS.has(type)) dropped = true;
    else kept.push(bytes.subarray(offset, end));
    offset = end;
    if (type === 'IEND') break;
  }
  return dropped && offset === bytes.length ? Buffer.concat(kept) : undefined;
}

function strippedJpeg(bytes: Buffer): Buffer | undefined {
  const kept: Buffer[] = [bytes.subarray(0, 2)];
  let offset = 2;
  let dropped = false;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xda) {
      // Start of scan: everything after it is entropy-coded pixels.
      kept.push(bytes.subarray(offset));
      return dropped ? Buffer.concat(kept) : undefined;
    }
    const end = offset + 2 + bytes.readUInt16BE(offset + 2);
    if (end > bytes.length) return undefined;
    if (JPEG_METADATA_MARKERS.has(marker)) dropped = true;
    else kept.push(bytes.subarray(offset, end));
    offset = end;
  }
  return undefined;
}
