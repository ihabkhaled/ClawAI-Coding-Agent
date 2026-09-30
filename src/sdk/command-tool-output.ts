import { StringDecoder } from 'node:string_decoder';

import { COMMAND_HEAD_CHARS } from './command-tool.constants';

import type { CapturedText } from './command-tool.types';

/** Marks where the middle of a long stream was left out. */
export function omissionMarker(omitted: number): string {
  return `... [${String(omitted)} chars omitted] ...`;
}

/**
 * How much of a budget the head may take: the usual head, but never so much
 * that the tail, where the error is, gets under a quarter of a small budget.
 */
export function headLength(budget: number, head: number): number {
  return Math.min(head, budget - Math.floor(budget / 4));
}

/**
 * Keeps both ends of a long text: the first `COMMAND_HEAD_CHARS` and the last
 * of what the budget leaves. The tail is where a failing build prints its
 * error, so a head-only cut discards exactly the part the model needs.
 */
export function headAndTail(text: string, limit: number): CapturedText {
  if (text.length <= limit) return { text, truncated: false, omitted: 0 };
  const head = headLength(limit, COMMAND_HEAD_CHARS);
  const tail = limit - head;
  const omitted = text.length - head - tail;
  return {
    text: `${text.slice(0, head)}${omissionMarker(omitted)}${tail === 0 ? '' : text.slice(-tail)}`,
    truncated: true,
    omitted,
  };
}

/**
 * Collects a stream without holding all of it. Memory stays at one head plus
 * one tail however much a noisy build prints, which matters for a command the
 * model was told may run for half an hour.
 */
export class StreamCapture {
  private readonly decoder = new StringDecoder('utf8');
  private readonly headSize: number;
  private readonly tailSize: number;
  private head = '';
  private tail = '';
  private total = 0;

  public constructor(limit: number) {
    this.headSize = headLength(limit, COMMAND_HEAD_CHARS);
    this.tailSize = limit - this.headSize;
  }

  public push(chunk: Buffer | string): void {
    this.add(typeof chunk === 'string' ? chunk : this.decoder.write(chunk));
  }

  /** Characters seen so far, before any cut. */
  public length(): number {
    return this.total;
  }

  /** The text so far, cut to `budget` characters when given (never more than was kept). */
  public result(budget: number = this.headSize + this.tailSize): CapturedText {
    this.add(this.decoder.end());
    if (this.total <= budget) return { text: this.head + this.tail, truncated: false, omitted: 0 };
    const head = this.head.slice(0, headLength(budget, this.head.length));
    const tailBudget = Math.max(0, Math.min(budget - head.length, this.tail.length));
    const tail = this.tail.slice(this.tail.length - tailBudget);
    const omitted = this.total - head.length - tail.length;
    return {
      text: `${head}${omissionMarker(omitted)}${tail}`,
      truncated: true,
      omitted,
    };
  }

  private add(text: string): void {
    if (text.length === 0) return;
    this.total += text.length;
    const room = this.headSize - this.head.length;
    const intoHead = room > 0 ? text.slice(0, room) : '';
    this.head += intoHead;
    const rest = text.slice(intoHead.length);
    if (rest.length === 0 || this.tailSize === 0) return;
    this.tail = (this.tail + rest).slice(-this.tailSize);
  }
}
