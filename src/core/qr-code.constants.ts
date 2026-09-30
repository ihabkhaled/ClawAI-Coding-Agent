/** Versions 1 to 10 hold a pairing URL with room to spare. */
export const QR_MIN_VERSION = 1;
export const QR_MAX_VERSION = 10;
export const QR_MASK_COUNT = 8;
export const QR_QUIET_ZONE = 4;

/** Error-correction level M. Index is the version; index 0 is unused. */
export const QR_ECC_PER_BLOCK_M: readonly number[] = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
export const QR_BLOCKS_M: readonly number[] = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

/** Level M is encoded as 0 in the two format bits. */
export const QR_FORMAT_LEVEL_BITS_M = 0;
export const QR_FORMAT_GENERATOR = 0x537;
export const QR_FORMAT_XOR = 0x5412;
export const QR_VERSION_GENERATOR = 0x1f25;
export const QR_GF_POLYNOMIAL = 0x11d;

export const QR_BYTE_MODE_BITS = 0b0100;
export const QR_PAD_BYTES: readonly number[] = [0xec, 0x11];

export const QR_PENALTY_RUN = 3;
export const QR_PENALTY_BLOCK = 3;
export const QR_PENALTY_FINDER = 40;
export const QR_PENALTY_BALANCE = 10;
export const QR_FINDER_LIKE: readonly boolean[] = [
  true,
  false,
  true,
  true,
  true,
  false,
  true,
  false,
  false,
  false,
  false,
];
