import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { redactText } from '../core/redaction';

import { killCommandTree, launchCommand } from './command-tool-spawn';
import { COMMAND_DEFAULT_OUTPUT_CHARS, COMMAND_DEFAULT_TIMEOUT_MS } from './command-tool.constants';
import { killOnProcessExit } from './process-watch-exit';
import { killTreeNow, reapGroup } from './process-watch-kill';
import { WatchLog } from './process-watch-log';
import { WatchLogFile } from './process-watch-log-file';
import {
  PROCESS_WATCH_EXIT_SETTLE_MS,
  PROCESS_WATCH_FILE_BYTES,
  PROCESS_WATCH_MAX_CONCURRENT,
  PROCESS_WATCH_MAX_CONCURRENT_CEILING,
  PROCESS_WATCH_MEMORY_CHARS,
  PROCESS_WATCH_RETAINED,
  PROCESS_WATCH_STOP_SETTLE_MS,
} from './process-watch-tool.constants';
import { waitForProcess } from './process-watch-wait';

import type { ProcessWatchOptions, WatchedProcess, WatchRequest } from './process-watch-tool.types';
import type { WatchWaitOptions } from './process-watch-wait';

type Report = Record<string, unknown>;

interface Entry {
  readonly process: WatchedProcess;
  readonly log: WatchLog;
  readonly file: WatchLogFile;
}

/**
 * The processes one run started with `process.watch`.
 *
 * At most `maxConcurrent` are alive; each has its own redacted log (a memory
 * ring read by cursor, and a capped file in a temp folder). Everything is
 * killed, with no grace, when the run ends, when the host exits, and when the
 * host is interrupted, so a dev server cannot outlive the run that started it.
 */
export class ProcessRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly maxConcurrent: number;
  private directory: string | undefined;
  private withdraw: (() => void) | undefined;
  private disposed = false;
  private started = 0;

  public constructor(private readonly options: ProcessWatchOptions) {
    this.maxConcurrent = Math.min(
      Math.max(Math.trunc(options.maxConcurrent ?? PROCESS_WATCH_MAX_CONCURRENT), 1),
      PROCESS_WATCH_MAX_CONCURRENT_CEILING,
    );
  }

  public start(request: WatchRequest): Report {
    if (this.disposed) throw new Error('process.watch has been shut down for this run.');
    const existing = this.entries.get(request.name);
    if (existing !== undefined && !existing.process.finished) {
      throw new Error(
        `A process named ${request.name} is already running; stop it or pick another name.`,
      );
    }
    if (this.aliveCount() >= this.maxConcurrent) {
      throw new Error(
        `At most ${String(this.maxConcurrent)} processes may run at once (${this.aliveNames()}); stop one first.`,
      );
    }
    const child = launchCommand(
      {
        executable: request.executable,
        arguments: request.arguments,
        cwd: request.cwd,
        timeoutMs: COMMAND_DEFAULT_TIMEOUT_MS,
        maxOutputChars: COMMAND_DEFAULT_OUTPUT_CHARS,
        background: true,
      },
      this.options.runtime,
    );
    if (existing !== undefined) this.discard(request.name, existing);
    this.evictFinished();
    this.started += 1;
    const file = new WatchLogFile(
      this.logDirectory(),
      logFileName(this.started, request.name),
      this.options.fileBytes ?? PROCESS_WATCH_FILE_BYTES,
    );
    const log = new WatchLog(this.options.memoryChars ?? PROCESS_WATCH_MEMORY_CHARS, file);
    const watched: WatchedProcess = {
      name: request.name,
      command: redactText([request.executable, ...request.arguments].join(' ')).slice(0, 300),
      child,
      startedAt: Date.now(),
      pid: child.pid,
      finished: false,
      finishedAt: undefined,
      exitCode: null,
      signal: null,
      stopRequested: false,
      error: undefined,
      lastSeenEnd: 0,
      idleWaits: 0,
      waiters: new Set(),
    };
    const entry = { process: watched, log, file };
    this.entries.set(request.name, entry);
    this.withdraw ??= killOnProcessExit(() => {
      this.killAllNow();
    });
    this.observe(entry);
    return { name: request.name, running: true, pid: watched.pid, nextCursor: 0 };
  }

  public status(name: string | undefined): Report {
    if (name !== undefined) return this.describe(this.find(name));
    return { processes: [...this.entries.values()].map((entry) => this.describe(entry)) };
  }

  public output(name: string, since: number | undefined, limit: number): Report {
    const entry = this.find(name);
    return { ...this.describe(entry, false), ...sliceFields(latest(entry.log, since, limit)) };
  }

  public async wait(
    name: string,
    options: Omit<WatchWaitOptions, 'entry'>,
    limit: number,
  ): Promise<Report> {
    const entry = this.find(name);
    const outcome = await waitForProcess({ ...options, entry });
    return {
      ...this.describe(entry, false),
      reason: outcome.reason,
      ...(outcome.matchedLine === undefined ? {} : { matchedLine: outcome.matchedLine }),
      waitedMs: outcome.waitedMs,
      ...sliceFields(latest(entry.log, options.sinceCursor, limit)),
      ...(outcome.note === undefined ? {} : { note: outcome.note }),
    };
  }

  public async stop(name: string, limit: number): Promise<Report> {
    const entry = this.find(name);
    const watched = entry.process;
    if (!watched.finished) {
      watched.stopRequested = true;
      killCommandTree(watched.child, this.options.runtime.platform);
      await waitForProcess({
        entry,
        timeoutMs: PROCESS_WATCH_STOP_SETTLE_MS,
        signal: undefined,
        sinceCursor: undefined,
        pattern: undefined,
      });
    }
    return {
      ...this.describe(entry, false),
      ...sliceFields(latest(entry.log, undefined, limit)),
      ...(watched.finished
        ? {}
        : { note: 'The process was told to stop but has not exited yet; check status.' }),
    };
  }

  /** Kills everything alive now, ends the logs, and deletes the temp folder. */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.killAllNow();
    for (const entry of this.entries.values()) {
      entry.log.dispose();
      entry.process.finished = true;
      for (const wake of [...entry.process.waiters]) wake();
    }
    this.withdraw?.();
    this.withdraw = undefined;
    if (this.directory !== undefined) {
      const directory = this.directory;
      this.directory = undefined;
      setTimeout(() => {
        try {
          rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        } catch {
          // A just-killed process can hold a log for a moment on Windows; it is a temp folder.
        }
      }, 500).unref();
    }
  }

  /** How many processes are alive. */
  public aliveCount(): number {
    return [...this.entries.values()].filter((entry) => !entry.process.finished).length;
  }

  private killAllNow(): void {
    for (const entry of this.entries.values()) {
      if (!entry.process.finished) {
        entry.process.stopRequested = true;
        killTreeNow(entry.process.child, this.options.runtime.platform);
      }
    }
  }

  private aliveNames(): string {
    return [...this.entries.values()]
      .filter((entry) => !entry.process.finished)
      .map((entry) => entry.process.name)
      .join(', ');
  }

  private logDirectory(): string {
    this.directory ??= mkdtempSync(path.join(this.options.logRoot ?? tmpdir(), 'claw-watch-'));
    return this.directory;
  }

  private find(name: string): Entry {
    const entry = this.entries.get(name);
    if (entry === undefined) {
      const known = [...this.entries.keys()].join(', ');
      throw new Error(
        `No process named ${name}.${known.length === 0 ? ' None has been started.' : ` Known: ${known}.`}`,
      );
    }
    return entry;
  }

  private describe(entry: Entry, withLog = true): Report {
    const watched = entry.process;
    return {
      name: watched.name,
      running: !watched.finished,
      // A process the run stopped reports the stop, not the code the kill left behind (1 on Windows).
      exitCode: watched.stopRequested ? null : watched.exitCode,
      signal: watched.signal,
      ...(watched.stopRequested ? { stopped: true } : {}),
      ...(watched.error === undefined ? {} : { error: watched.error }),
      ...(withLog
        ? {
            command: watched.command,
            pid: watched.pid,
            durationMs: (watched.finishedAt ?? Date.now()) - watched.startedAt,
            outputChars: entry.log.end,
            lines: entry.log.lines,
          }
        : {}),
    };
  }

  private observe(entry: Entry): void {
    const watched = entry.process;
    const { child } = watched;
    child.stdout?.on('data', (chunk: Buffer) => {
      entry.log.feed(0, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      entry.log.feed(1, chunk);
    });
    const finish = (code: number | null, signal: string | null, error?: string): void => {
      if (watched.finished) return;
      watched.finished = true;
      watched.finishedAt = Date.now();
      watched.exitCode = code ?? -1;
      watched.signal = signal;
      watched.error = error;
      entry.log.finish();
      entry.file.close();
      for (const wake of [...watched.waiters]) wake();
    };
    child.on('error', (error) => {
      finish(null, null, redactText(error.message));
    });
    child.on('exit', (code, signal) => {
      reapGroup(watched.pid, this.options.runtime.platform);
      setTimeout(() => {
        finish(code, signal);
      }, PROCESS_WATCH_EXIT_SETTLE_MS).unref();
    });
    child.on('close', (code, signal) => {
      finish(code, signal);
    });
  }

  private discard(name: string, entry: Entry): void {
    entry.log.dispose();
    entry.file.remove();
    this.entries.delete(name);
  }

  private evictFinished(): void {
    for (const [name, entry] of this.entries) {
      if (this.entries.size < PROCESS_WATCH_RETAINED) return;
      if (entry.process.finished) this.discard(name, entry);
    }
  }
}

function sliceFields(slice: ReturnType<WatchLog['read']>): Report {
  return {
    output: slice.output,
    nextCursor: slice.nextCursor,
    fromCursor: slice.fromCursor,
    ...(slice.truncated ? { truncated: true, omittedChars: slice.omittedChars } : {}),
    ...(slice.droppedEarlier ? { droppedEarlier: true } : {}),
  };
}

/**
 * What to show: with a cursor, everything since it (head and tail if long);
 * without one, the latest `limit` characters, because a caller that never read
 * before wants the current state, not the first screenful of a long log. Asking
 * for `sinceCursor: 0` is how to see the beginning.
 */
function latest(
  log: WatchLog,
  since: number | undefined,
  limit: number,
): ReturnType<WatchLog['read']> {
  return log.read(since ?? Math.max(log.base, log.end - limit), limit);
}

/**
 * The log file's base name: a sequence number first, so a model-chosen name such
 * as `CON` or `nul` (reserved device names on Windows, whatever extension follows)
 * can never make the log a device, and two names can never share a file.
 */
function logFileName(sequence: number, name: string): string {
  return `${String(sequence)}-${name}`;
}
