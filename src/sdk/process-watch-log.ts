import { StringDecoder } from 'node:string_decoder';

import { redactText } from '../core/redaction';

import { headAndTail } from './command-tool-output';
import {
  PROCESS_WATCH_FLUSH_MS,
  PROCESS_WATCH_MATCH_LINE_CHARS,
  PROCESS_WATCH_MAX_LINE_CHARS,
} from './process-watch-tool.constants';

import type { WatchLogFile } from './process-watch-log-file';
import type { LinePattern, LogMatch, LogSlice } from './process-watch-tool.types';

interface Chunk {
  readonly start: number;
  readonly text: string;
}

interface Stream {
  readonly decoder: StringDecoder;
  pending: string;
  timer: NodeJS.Timeout | undefined;
}

/**
 * One process's output: redacted, kept in a bounded ring, readable by cursor.
 *
 * The cursor is a character position in the redacted stream, counted from the
 * first byte the process ever printed. It only grows, so a position handed out
 * once stays meaningful after older output has been dropped from memory:
 * reading from a dropped position simply starts at what is still held and says
 * so. Text is committed a line at a time (a quiet partial line is committed
 * after a short delay, so a prompt without a newline is seen), and redaction
 * runs on each committed piece, so a secret is never held unredacted anywhere
 * a read or the file can reach it.
 */
export class WatchLog {
  private readonly chunks: Chunk[] = [];
  private readonly streams: readonly [Stream, Stream] = [newStream(), newStream()];
  private held = 0;
  private total = 0;
  private lineCount = 0;
  private readonly listeners = new Set<() => void>();

  public constructor(
    private readonly memoryChars: number,
    private readonly file: WatchLogFile | undefined,
  ) {}

  /** Characters committed so far: the cursor a reader at the end holds. */
  public get end(): number {
    return this.total;
  }

  public get lines(): number {
    return this.lineCount;
  }

  /** The first position still held in memory. */
  public get base(): number {
    return this.chunks[0]?.start ?? this.total;
  }

  public onCommit(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Takes a raw chunk from stdout (`0`) or stderr (`1`). */
  public feed(source: 0 | 1, chunk: Buffer): void {
    const stream = this.streams[source];
    stream.pending += stream.decoder.write(chunk);
    this.drain(stream);
  }

  /** Commits whatever is still pending; called when the process has finished. */
  public finish(): void {
    for (const stream of this.streams) {
      stream.pending += stream.decoder.end();
      this.commitPending(stream);
    }
  }

  /** What was printed since `since` (or everything held), cut to `limit` characters, head and tail. */
  public read(since: number | undefined, limit: number): LogSlice {
    const base = this.base;
    const requested = since ?? base;
    const from = Math.min(Math.max(requested, base), this.total);
    const shown = headAndTail(this.textFrom(from), limit);
    return {
      output: shown.text,
      nextCursor: this.total,
      fromCursor: from,
      truncated: shown.truncated,
      omittedChars: shown.omitted,
      droppedEarlier: requested < base,
    };
  }

  /**
   * The first line from `from` on that `pattern` matches, with the position
   * after it, or the position to resume from when none does. A line still being
   * written is tested too, and retested once it grows, so a prompt is found.
   */
  public search(
    pattern: LinePattern,
    from: number,
  ): { readonly match: LogMatch | undefined; readonly resume: number } {
    const start = Math.min(Math.max(from, this.base), this.total);
    const text = this.textFrom(start);
    let offset = start;
    for (const piece of splitKeepingNewlines(text)) {
      const line = piece.endsWith('\n') ? piece.slice(0, -1) : piece;
      if (pattern.test(line.slice(0, PROCESS_WATCH_MATCH_LINE_CHARS))) {
        return { match: { line, end: offset + piece.length }, resume: offset + piece.length };
      }
      if (!piece.endsWith('\n')) return { match: undefined, resume: offset };
      offset += piece.length;
    }
    return { match: undefined, resume: offset };
  }

  /** Drops timers; the committed text stays readable. */
  public dispose(): void {
    for (const stream of this.streams) {
      if (stream.timer !== undefined) clearTimeout(stream.timer);
      stream.timer = undefined;
    }
    this.file?.close();
  }

  private drain(stream: Stream): void {
    const cut = stream.pending.lastIndexOf('\n') + 1;
    if (cut > 0) {
      const complete = stream.pending.slice(0, cut);
      stream.pending = stream.pending.slice(cut);
      this.commit(complete);
    }
    if (stream.timer !== undefined) clearTimeout(stream.timer);
    stream.timer = undefined;
    if (stream.pending.length >= PROCESS_WATCH_MAX_LINE_CHARS) {
      this.commitPending(stream);
    } else if (stream.pending.length > 0) {
      stream.timer = setTimeout(() => {
        this.commitPending(stream);
      }, PROCESS_WATCH_FLUSH_MS);
      stream.timer.unref();
    }
  }

  private commitPending(stream: Stream): void {
    if (stream.timer !== undefined) clearTimeout(stream.timer);
    stream.timer = undefined;
    if (stream.pending.length === 0) return;
    const text = stream.pending;
    stream.pending = '';
    this.commit(text);
  }

  private commit(raw: string): void {
    const text = redactText(raw);
    if (text.length === 0) return;
    this.chunks.push({ start: this.total, text });
    this.total += text.length;
    this.held += text.length;
    this.lineCount += countNewlines(text);
    while (
      this.chunks.length > 1 &&
      this.held - (this.chunks[0]?.text.length ?? 0) >= this.memoryChars
    ) {
      this.held -= this.chunks.shift()?.text.length ?? 0;
    }
    this.file?.write(text);
    for (const listener of [...this.listeners]) listener();
  }

  private textFrom(position: number): string {
    if (position >= this.total) return '';
    const index = this.chunkAt(position);
    const first = this.chunks[index];
    if (first === undefined) return '';
    const head = first.text.slice(position - first.start);
    if (index === this.chunks.length - 1) return head;
    return (
      head +
      this.chunks
        .slice(index + 1)
        .map((chunk) => chunk.text)
        .join('')
    );
  }

  /** The index of the chunk holding `position`, by binary search on chunk starts. */
  private chunkAt(position: number): number {
    let low = 0;
    let high = this.chunks.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((this.chunks[middle]?.start ?? 0) <= position) low = middle;
      else high = middle - 1;
    }
    return low;
  }
}

function newStream(): Stream {
  return { decoder: new StringDecoder('utf8'), pending: '', timer: undefined };
}

function countNewlines(text: string): number {
  let count = 0;
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    count += 1;
  }
  return count;
}

/** `a\nb\nc` as `['a\n', 'b\n', 'c']`. */
function splitKeepingNewlines(text: string): string[] {
  const pieces: string[] = [];
  let from = 0;
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', from)) {
    pieces.push(text.slice(from, index + 1));
    from = index + 1;
  }
  if (from < text.length) pieces.push(text.slice(from));
  return pieces;
}
