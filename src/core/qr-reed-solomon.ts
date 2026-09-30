import { QR_GF_POLYNOMIAL } from './qr-code.constants';

function multiply(x: number, y: number): number {
  let product = 0;
  for (let bit = 7; bit >= 0; bit -= 1) {
    product = (product << 1) ^ ((product >>> 7) * QR_GF_POLYNOMIAL);
    product ^= ((y >>> bit) & 1) * x;
  }
  return product;
}

/** The generator polynomial of the given degree over GF(256), leading term implicit. */
function divisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = multiply(result[j] ?? 0, root);
      if (j + 1 < degree) result[j] = (result[j] ?? 0) ^ (result[j + 1] ?? 0);
    }
    root = multiply(root, 2);
  }
  return result;
}

/** The Reed-Solomon error-correction codewords for one block of data. */
export function reedSolomonRemainder(data: readonly number[], degree: number): number[] {
  const generator = divisor(degree);
  const result = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0);
    result.push(0);
    generator.forEach((coefficient, index) => {
      result[index] = (result[index] ?? 0) ^ multiply(coefficient, factor);
    });
  }
  return result;
}
