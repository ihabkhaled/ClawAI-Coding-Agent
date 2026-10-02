import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { WatchLog } from '../../src/sdk/process-watch-log';
import { WatchLogFile } from '../../src/sdk/process-watch-log-file';

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

/** Feeds `text` in pieces of pseudo-random size, so lines and UTF-8 sequences are split. */
function feedInPieces(log: WatchLog, text: string, onPiece?: () => void): void {
  const bytes = Buffer.from(text, 'utf8');
  let seed = 7;
  for (let from = 0; from < bytes.length;) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const size = 1 + (seed % 700);
    log.feed(0, bytes.subarray(from, from + size));
    from += size;
    onPiece?.();
  }
  log.finish();
}

function numbered(count: number): string {
  let text = '';
  for (let line = 1; line <= count; line += 1) text += `line ${String(line)} é\n`;
  return text;
}

describe('WatchLog cursors', () => {
  it('reads 100k lines incrementally with no gap and no repeat', () => {
    const log = new WatchLog(1_048_576, undefined);
    const expected = numbered(100_000);
    let cursor = 0;
    let collected = '';
    let reads = 0;
    const began = Date.now();

    feedInPieces(log, expected, () => {
      if (log.end - cursor < 20_000) return;
      const slice = log.read(cursor, 50_000);
      expect(slice.droppedEarlier).toBe(false);
      expect(slice.truncated).toBe(false);
      collected += slice.output;
      cursor = slice.nextCursor;
      reads += 1;
    });
    const last = log.read(cursor, 50_000);
    collected += last.output;

    expect(collected).toBe(expected);
    expect(last.nextCursor).toBe(expected.length);
    expect(log.lines).toBe(100_000);
    expect(reads).toBeGreaterThan(10);
    expect(Date.now() - began).toBeLessThan(15_000);
  });

  it('a reader that falls behind the ring is told, and starts at what is still held', () => {
    const log = new WatchLog(50_000, undefined);
    feedInPieces(log, numbered(20_000));

    const slice = log.read(0, 4_000);

    expect(slice.droppedEarlier).toBe(true);
    expect(slice.fromCursor).toBe(log.base);
    expect(log.base).toBeGreaterThan(0);
    expect(slice.nextCursor).toBe(log.end);
    expect(slice.output).toContain('line 20000');
    expect(slice.truncated).toBe(true);
  });

  it('a cursor past the end reads nothing, and a stale cursor does not repeat output', () => {
    const log = new WatchLog(1_000_000, undefined);
    log.feed(0, Buffer.from('one\ntwo\n'));

    expect(log.read(9_999, 1_000).output).toBe('');
    const first = log.read(undefined, 1_000);
    expect(first.output).toBe('one\ntwo\n');
    expect(log.read(first.nextCursor, 1_000).output).toBe('');
  });

  it('keeps head and tail of a slice larger than the budget', () => {
    const log = new WatchLog(1_000_000, undefined);
    log.feed(0, Buffer.from(numbered(5_000)));

    const slice = log.read(undefined, 1_000);

    expect(slice.truncated).toBe(true);
    expect(slice.output.startsWith('line 1 ')).toBe(true);
    expect(slice.output.trimEnd().endsWith('line 5000 é')).toBe(true);
    expect(slice.omittedChars).toBeGreaterThan(40_000);
  });

  it('commits a quiet partial line so a prompt without a newline is visible', async () => {
    const log = new WatchLog(1_000, undefined);
    log.feed(0, Buffer.from('Password prompt> '));
    expect(log.read(undefined, 100).output).toBe('');

    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(log.read(undefined, 100).output).toBe('Password prompt> ');
    log.dispose();
  });

  it('keeps stdout and stderr partial lines apart', () => {
    const log = new WatchLog(1_000, undefined);
    log.feed(0, Buffer.from('out-1 '));
    log.feed(1, Buffer.from('err-1\n'));
    log.feed(0, Buffer.from('out-2\n'));

    expect(log.read(undefined, 100).output).toBe('err-1\nout-1 out-2\n');
  });

  it('redacts secrets before they reach memory', () => {
    const log = new WatchLog(10_000, undefined);
    log.feed(
      0,
      Buffer.from(
        'Authorization: Bearer abcdef0123456789\nGITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123\nok\n',
      ),
    );

    const text = log.read(undefined, 1_000).output;

    expect(text).not.toContain('abcdef0123456789');
    expect(text).not.toContain('ghp_abcdefghij');
    expect(text).toContain('ok');
  });
});

describe('WatchLog search', () => {
  it('finds a line already printed, resumes after a miss, and finds a line still being written', async () => {
    const log = new WatchLog(10_000, undefined);
    log.feed(0, Buffer.from('starting\nready on 4000\n'));

    const hit = log.search(/ready on \d+/iu, 0);
    expect(hit.match?.line).toBe('ready on 4000');

    const miss = log.search(/never/iu, 0);
    expect(miss.match).toBeUndefined();
    expect(miss.resume).toBe(log.end);

    log.feed(0, Buffer.from('half a li'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const partial = log.search(/half/iu, miss.resume);
    expect(partial.match?.line).toBe('half a li');
  });

  it('tests a line again once the rest of it arrives', () => {
    const log = new WatchLog(10_000, undefined);
    log.feed(0, Buffer.from('listen'));
    const first = log.search(/listening/iu, 0);
    expect(first.match).toBeUndefined();

    log.feed(0, Buffer.from('ing on 80\n'));

    expect(log.search(/listening on 80/iu, first.resume).match?.line).toBe('listening on 80');
  });
});

describe('WatchLogFile', () => {
  it('alternates two files so disk use stays under twice the cap', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'claw-watch-file-'));
    created.push(directory);
    const file = new WatchLogFile(directory, 'job', 1_000);
    for (let index = 0; index < 500; index += 1) file.write(`${'x'.repeat(99)}\n`);
    file.close();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const names = readdirSync(directory).sort();
    const total = names.reduce((sum, name) => sum + statSync(path.join(directory, name)).size, 0);

    expect(names).toEqual(['job.0.log', 'job.1.log']);
    expect(total).toBeLessThanOrEqual(2_000);
    expect(readFileSync(path.join(directory, names[0] ?? ''), 'utf8').length).toBeGreaterThan(0);
  });

  it('remove deletes the files', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'claw-watch-file-'));
    created.push(directory);
    const file = new WatchLogFile(directory, 'job', 1_000);
    file.write('hello\n');
    file.remove();

    expect(readdirSync(directory).filter((name) => name.startsWith('job'))).toEqual([]);
  });
});
