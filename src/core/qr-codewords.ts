import {
  QR_BLOCKS_M,
  QR_BYTE_MODE_BITS,
  QR_ECC_PER_BLOCK_M,
  QR_MAX_VERSION,
  QR_MIN_VERSION,
  QR_PAD_BYTES,
} from './qr-code.constants';
import { reedSolomonRemainder } from './qr-reed-solomon';

/** Every module that is not a function pattern, in bits. */
export function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function eccPerBlock(version: number): number {
  return QR_ECC_PER_BLOCK_M[version] ?? 0;
}

function blockCount(version: number): number {
  return QR_BLOCKS_M[version] ?? 1;
}

export function dataCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8) - eccPerBlock(version) * blockCount(version);
}

function countBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

/** The smallest version whose byte-mode capacity holds `length` bytes. */
export function versionFor(length: number): number {
  for (let version = QR_MIN_VERSION; version <= QR_MAX_VERSION; version += 1) {
    if (4 + countBits(version) + length * 8 <= dataCodewords(version) * 8) return version;
  }
  throw new RangeError('The text is too long for a version 10 QR code.');
}

function pushBits(bits: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
}

function dataBits(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  pushBits(bits, QR_BYTE_MODE_BITS, 4);
  pushBits(bits, bytes.length, countBits(version));
  for (const byte of bytes) pushBits(bits, byte, 8);
  return bits;
}

function packData(bytes: Uint8Array, version: number): number[] {
  const capacityBits = dataCodewords(version) * 8;
  const bits = dataBits(bytes, version);
  pushBits(bits, 0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  for (let pad = 0; codewords.length < dataCodewords(version); pad += 1) {
    codewords.push(QR_PAD_BYTES[pad % 2] ?? 0);
  }
  return codewords;
}

/** Splits into blocks, appends the error correction of each, and interleaves. */
export function interleavedCodewords(bytes: Uint8Array, version: number): number[] {
  const data = packData(bytes, version);
  const blocks = blockCount(version);
  const eccLength = eccPerBlock(version);
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const built: number[][] = [];
  let offset = 0;
  for (let i = 0; i < blocks; i += 1) {
    const length = shortLength - eccLength + (i < shortBlocks ? 0 : 1);
    const block = data.slice(offset, offset + length);
    offset += length;
    const ecc = reedSolomonRemainder(block, eccLength);
    if (i < shortBlocks) block.push(0);
    built.push([...block, ...ecc]);
  }
  const result: number[] = [];
  const width = built[0]?.length ?? 0;
  for (let i = 0; i < width; i += 1) {
    built.forEach((block, j) => {
      if (i !== shortLength - eccLength || j >= shortBlocks) result.push(block[i] ?? 0);
    });
  }
  return result;
}
