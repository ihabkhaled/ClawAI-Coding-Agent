import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import type { WriteStream } from 'node:fs';

/**
 * The on-disk copy of one process's log, capped.
 *
 * Two files alternate: when the current one reaches `maxBytes` the other is
 * truncated and written next, so disk use never passes twice the cap however
 * long a dev server runs, and a rotation never renames a file a stream holds.
 * A disk error stops the copy and never reaches the process or the model: the
 * in-memory log is the one that is read.
 */
export class WatchLogFile {
  private stream: WriteStream | undefined;
  private bytes = 0;
  private failed = false;
  private slot = 0;

  public constructor(
    private readonly directory: string,
    private readonly name: string,
    private readonly maxBytes: number,
  ) {}

  /** The file currently written. */
  public get file(): string {
    return this.slotFile(this.slot);
  }

  public write(text: string): void {
    if (this.failed || text.length === 0) return;
    try {
      this.open().write(text);
      this.bytes += Buffer.byteLength(text);
      if (this.bytes >= this.maxBytes) this.rotate();
    } catch {
      this.failed = true;
    }
  }

  /** Flushes and closes; the files stay for a person to read. */
  public close(): void {
    this.stream?.end();
    this.stream = undefined;
  }

  /** Closes and deletes both files. */
  public remove(): void {
    this.close();
    for (const slot of [0, 1]) {
      try {
        rmSync(this.slotFile(slot), { force: true });
      } catch {
        // Windows may still hold the file for a moment; the folder is under the temp dir.
      }
    }
  }

  private slotFile(slot: number): string {
    return path.join(this.directory, `${this.name}.${String(slot)}.log`);
  }

  private open(): WriteStream {
    if (this.stream !== undefined) return this.stream;
    mkdirSync(this.directory, { recursive: true });
    const stream = createWriteStream(this.file, { flags: 'w' });
    stream.on('error', () => {
      this.failed = true;
    });
    this.stream = stream;
    return stream;
  }

  private rotate(): void {
    this.close();
    this.bytes = 0;
    this.slot = this.slot === 0 ? 1 : 0;
  }
}
