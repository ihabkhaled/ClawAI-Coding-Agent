import { Buffer } from 'node:buffer';

/**
 * How much of a truncated stream is kept from the start.
 *
 * The rest is kept from the end. Compilers, test runners and package managers
 * all put the answer last — the failing assertion, the type error, the exit
 * summary — while the start is banners, dependency resolution and progress.
 * Keeping only the head therefore dropped precisely the part the reader needed,
 * and a truncated log read as though the command had produced nothing useful.
 */
const HEAD_SHARE = 0.25;

export interface BoundedOutput {
  readonly text: string;
  readonly truncated: boolean;
  /** Bytes the process wrote that this buffer did not keep. */
  readonly omittedBytes: number;
}

/**
 * Collects a process stream inside a byte budget, keeping both ends.
 *
 * Memory stays bounded: the head stops growing once its share is full, and the
 * tail is trimmed on every append, so a command that writes a gigabyte still
 * costs the budget and no more.
 */
export class BoundedOutputBuffer {
  private readonly headLimit: number;
  private readonly tailLimit: number;
  private readonly head: Buffer[] = [];
  private headBytes = 0;
  private readonly tail: Buffer[] = [];
  private tailBytes = 0;
  private droppedBytes = 0;

  constructor(private readonly limitBytes: number) {
    this.headLimit = Math.max(1, Math.floor(limitBytes * HEAD_SHARE));
    this.tailLimit = Math.max(1, limitBytes - this.headLimit);
  }

  append(chunk: Buffer): void {
    let remainder = chunk;
    if (this.headBytes < this.headLimit) {
      const take = Math.min(this.headLimit - this.headBytes, remainder.byteLength);
      this.head.push(remainder.subarray(0, take));
      this.headBytes += take;
      remainder = remainder.subarray(take);
    }
    if (remainder.byteLength === 0) return;
    this.tail.push(remainder);
    this.tailBytes += remainder.byteLength;
    this.trimTail();
  }

  private trimTail(): void {
    while (this.tailBytes > this.tailLimit) {
      const excess = this.tailBytes - this.tailLimit;
      const oldest = this.tail[0];
      if (oldest === undefined) return;
      if (oldest.byteLength <= excess) {
        this.tail.shift();
        this.tailBytes -= oldest.byteLength;
        this.droppedBytes += oldest.byteLength;
        continue;
      }
      this.tail[0] = oldest.subarray(excess);
      this.tailBytes -= excess;
      this.droppedBytes += excess;
    }
  }

  /**
   * The kept output, with an explicit marker where the gap is.
   *
   * The marker is this module's own text and states the byte count, so a model
   * reading the result can tell a complete log from a middle-elided one rather
   * than inferring it from a suspiciously abrupt line. Decoding is lossy on
   * purpose: a byte budget cuts wherever it lands, including through a UTF-8
   * sequence, and a replacement character is a better answer than a throw.
   */
  result(): BoundedOutput {
    const head = Buffer.concat(this.head).toString('utf8');
    if (this.droppedBytes === 0) {
      return {
        text: head + Buffer.concat(this.tail).toString('utf8'),
        truncated: false,
        omittedBytes: 0,
      };
    }
    const marker = `\n… ${String(this.droppedBytes)} bytes omitted; the start and the end of the output are kept …\n`;
    return {
      text: head + marker + Buffer.concat(this.tail).toString('utf8'),
      truncated: true,
      omittedBytes: this.droppedBytes,
    };
  }

  get budgetBytes(): number {
    return this.limitBytes;
  }
}
