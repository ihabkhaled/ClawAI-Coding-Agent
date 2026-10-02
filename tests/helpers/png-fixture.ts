import { deflateSync } from 'node:zlib';

/** One pixel's color. */
export type Rgb = readonly [number, number, number];

const CRC_TABLE = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c % 2 === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, data and the CRC over type and data. */
export function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A real, decodable PNG drawn pixel by pixel: the tiny encoder the tests use in
 * place of a browser. `extraChunks` go between the header and the pixels, which
 * is where tools put text and EXIF.
 */
export function makePng(
  width: number,
  height: number,
  color: (x: number, y: number) => Rgb,
  extraChunks: readonly Buffer[] = [],
): Buffer {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = color(x, y);
      raw.set([r, g, b], y * stride + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    ...extraChunks,
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A white page with one filled rectangle: enough to ask "what shape and color". */
export function redRectanglePng(extraChunks: readonly Buffer[] = []): Buffer {
  return makePng(
    120,
    80,
    (x, y) => (x > 20 && x < 100 && y > 20 && y < 60 ? [220, 30, 30] : [255, 255, 255]),
    extraChunks,
  );
}

/** The decoded pixel rows of a PNG made by `makePng`, to prove stripping left pixels alone. */
export function pngPixelData(png: Buffer): Buffer {
  const parts: Buffer[] = [];
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    if (png.toString('latin1', offset + 4, offset + 8) === 'IDAT') {
      parts.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }
  return Buffer.concat(parts);
}

/** A JPEG-shaped byte stream with EXIF, a comment and a scan: structure only, not decodable. */
export function jpegWithMetadata(): { bytes: Buffer; clean: Buffer } {
  const segment = (marker: number, payload: Buffer): Buffer => {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(payload.length + 2);
    return Buffer.concat([Buffer.from([0xff, marker]), length, payload]);
  };
  const soi = Buffer.from([0xff, 0xd8]);
  const exif = segment(0xe1, Buffer.from('Exif\0\0GPS=secret-location'));
  const comment = segment(0xfe, Buffer.from('made by a tool'));
  const table = segment(0xdb, Buffer.alloc(65, 1));
  const scan = Buffer.concat([
    Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 63, 0]),
    Buffer.from([1, 2, 3, 4]),
    Buffer.from([0xff, 0xd9]),
  ]);
  return {
    bytes: Buffer.concat([soi, exif, table, comment, scan]),
    clean: Buffer.concat([soi, table, scan]),
  };
}

/** The smallest buffer that reads as a WebP by signature. */
export function webpStub(): Buffer {
  return Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBP')]);
}
