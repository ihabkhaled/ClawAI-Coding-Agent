import { StringDecoder } from 'node:string_decoder';

import { headAndTail } from './command-tool-output';
import { killCommandTree, launchCommand } from './command-tool-spawn';
import {
  COMMAND_BACKGROUND_BUFFER_CHARS,
  COMMAND_EXIT_SETTLE_MS,
  COMMAND_MAX_BACKGROUND,
  COMMAND_RETAINED_PROCESSES,
  COMMAND_STOP_SETTLE_MS,
} from './command-tool.constants';

import type { BackgroundProcess, CommandRequest, CommandRuntime } from './command-tool.types';

/** What `output`, `wait` and `stop` report about one background process. */
export interface BackgroundReport {
  readonly processId: string;
  readonly running: boolean;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly durationMs: number;
  readonly output: string;
  readonly truncated: boolean;
  /** Pass this back as `sinceOffset` to read only what arrived after this report. */
  readonly nextOffset: number;
  /** True when output before `sinceOffset`'s window was already dropped from the 1 MB buffer. */
  readonly droppedEarlier: boolean;
  readonly waitTimedOut?: boolean;
  readonly error?: string;
}

/**
 * The long-running processes a run started, at most four alive at once.
 *
 * A push hook or a dev server outlives any sensible foreground timeout, so the
 * model starts it here, keeps working, and reads the output when it wants to.
 * Output is one ring buffer per process so a chatty server cannot exhaust
 * memory, and every process dies with the run.
 */
export class BackgroundCommands {
  private readonly processes = new Map<string, BackgroundProcess>();
  private counter = 0;

  public constructor(private readonly runtime: CommandRuntime) {}

  public start(request: CommandRequest): { processId: string } {
    const live = [...this.processes.values()].filter((entry) => !entry.finished).length;
    if (live >= COMMAND_MAX_BACKGROUND) {
      throw new Error(
        `At most ${String(COMMAND_MAX_BACKGROUND)} background processes may run at once; stop one first.`,
      );
    }
    const child = launchCommand(request, this.runtime);
    this.counter += 1;
    const entry: BackgroundProcess = {
      processId: `bg-${String(this.counter)}`,
      child,
      startedAt: Date.now(),
      droppedChars: 0,
      buffer: '',
      exitCode: null,
      signal: null,
      finished: false,
      error: undefined,
      waiters: new Set(),
    };
    this.evictFinished();
    this.processes.set(entry.processId, entry);
    this.observe(entry);
    return { processId: entry.processId };
  }

  public output(processId: string, sinceOffset: number, limit: number): BackgroundReport {
    return this.report(this.find(processId), sinceOffset, limit);
  }

  public async wait(
    processId: string,
    timeoutMs: number,
    limit: number,
    signal: AbortSignal | undefined,
  ): Promise<BackgroundReport> {
    const entry = this.find(processId);
    const timedOut = !entry.finished && !(await this.settled(entry, timeoutMs, signal));
    return { ...this.report(entry, 0, limit), ...(timedOut ? { waitTimedOut: true } : {}) };
  }

  public async stop(processId: string, limit: number): Promise<BackgroundReport> {
    const entry = this.find(processId);
    if (!entry.finished) {
      killCommandTree(entry.child, this.runtime.platform);
      await this.settled(entry, COMMAND_STOP_SETTLE_MS, undefined);
    }
    return this.report(entry, 0, limit);
  }

  /** Kills everything still alive; called when the run ends. */
  public disposeAll(): void {
    for (const entry of this.processes.values()) {
      if (!entry.finished) killCommandTree(entry.child, this.runtime.platform);
    }
  }

  private find(processId: string): BackgroundProcess {
    const entry = this.processes.get(processId);
    if (entry === undefined) throw new Error(`No background process ${processId}.`);
    return entry;
  }

  private report(entry: BackgroundProcess, sinceOffset: number, limit: number): BackgroundReport {
    const from = Math.max(sinceOffset - entry.droppedChars, 0);
    const shown = headAndTail(entry.buffer.slice(from), limit);
    return {
      processId: entry.processId,
      running: !entry.finished,
      exitCode: entry.exitCode,
      signal: entry.signal,
      durationMs: Date.now() - entry.startedAt,
      output: shown.text,
      truncated: shown.truncated,
      nextOffset: entry.droppedChars + entry.buffer.length,
      droppedEarlier: sinceOffset < entry.droppedChars,
      ...(entry.error === undefined ? {} : { error: entry.error }),
    };
  }

  /** Resolves true when the process finished, false when the wait ran out or was aborted. */
  private settled(
    entry: BackgroundProcess,
    timeoutMs: number,
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const done = (finished: boolean): void => {
        clearTimeout(timer);
        entry.waiters.delete(wake);
        signal?.removeEventListener('abort', giveUp);
        resolve(finished);
      };
      const wake = (): void => {
        done(true);
      };
      const giveUp = (): void => {
        done(false);
      };
      const timer = setTimeout(giveUp, timeoutMs);
      entry.waiters.add(wake);
      signal?.addEventListener('abort', giveUp, { once: true });
    });
  }

  private observe(entry: BackgroundProcess): void {
    const decoders = [new StringDecoder('utf8'), new StringDecoder('utf8')];
    const append = (text: string): void => {
      entry.buffer += text;
      const excess = entry.buffer.length - COMMAND_BACKGROUND_BUFFER_CHARS;
      if (excess <= 0) return;
      entry.buffer = entry.buffer.slice(excess);
      entry.droppedChars += excess;
    };
    entry.child.stdout?.on('data', (chunk: Buffer) => {
      append(decoders[0]?.write(chunk) ?? '');
    });
    entry.child.stderr?.on('data', (chunk: Buffer) => {
      append(decoders[1]?.write(chunk) ?? '');
    });
    const finish = (code: number | null, signal: string | null, error?: string): void => {
      if (entry.finished) return;
      entry.finished = true;
      entry.exitCode = code ?? -1;
      entry.signal = signal;
      entry.error = error;
      for (const wake of [...entry.waiters]) wake();
    };
    entry.child.on('error', (error) => {
      finish(null, null, error.message);
    });
    entry.child.on('exit', (code, signal) => {
      setTimeout(() => {
        finish(code, signal);
      }, COMMAND_EXIT_SETTLE_MS).unref();
    });
    entry.child.on('close', (code, signal) => {
      finish(code, signal);
    });
  }

  private evictFinished(): void {
    for (const [id, entry] of this.processes) {
      if (this.processes.size < COMMAND_RETAINED_PROCESSES) return;
      if (entry.finished) this.processes.delete(id);
    }
  }
}
