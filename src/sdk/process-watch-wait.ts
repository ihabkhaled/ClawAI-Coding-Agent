import { PROCESS_WATCH_IDLE_WAITS_NOTE } from './process-watch-tool.constants';

import type { WatchLog } from './process-watch-log';
import type { LinePattern, WatchedProcess, WatchWaitReason } from './process-watch-tool.types';

/** What a wait watches: the process and its log. */
export interface WatchTarget {
  readonly process: WatchedProcess;
  readonly log: WatchLog;
}

export interface WatchWaitOptions {
  readonly entry: WatchTarget;
  readonly timeoutMs: number;
  readonly signal: AbortSignal | undefined;
  /** Output before this position is not searched; defaults to the start. */
  readonly sinceCursor: number | undefined;
  readonly pattern: LinePattern | undefined;
}

export interface WatchWaitOutcome {
  readonly reason: WatchWaitReason;
  readonly matchedLine?: string;
  readonly waitedMs: number;
  readonly note?: string;
}

const SLOW_NOTE =
  '"untilMatch" took too long on a line and was dropped (it can backtrack without end); wait with a simpler pattern.';

const IDLE_NOTE =
  'No new output across several waits. The process may be stuck or just quiet: read status, ' +
  'read the output, or stop it, rather than waiting again.';

/**
 * Returns when the process exits, a line matches the pattern, the timeout
 * passes, or the run is cancelled, whichever is first. The match is looked for
 * in what was already printed too, so a server that said "listening" before the
 * wait began is found at once. Nothing here outlives its own timeout or cancel.
 */
export function waitForProcess(options: WatchWaitOptions): Promise<WatchWaitOutcome> {
  const { process: watched, log } = options.entry;
  const began = Date.now();
  let scanFrom = options.sinceCursor ?? 0;
  const scan = (): string | undefined => {
    if (options.pattern === undefined) return undefined;
    const found = log.search(options.pattern, scanFrom);
    scanFrom = found.resume;
    return found.match?.line;
  };
  const outcome = (reason: WatchWaitReason, matchedLine?: string): WatchWaitOutcome => {
    const note = options.pattern?.tooSlow === true ? SLOW_NOTE : idleNote(watched, log.end, reason);
    return {
      reason,
      waitedMs: Date.now() - began,
      ...(matchedLine === undefined ? {} : { matchedLine }),
      ...(note === undefined ? {} : { note }),
    };
  };
  if (options.signal?.aborted === true) return Promise.resolve(outcome('cancelled'));
  const early = scan();
  if (early !== undefined) return Promise.resolve(outcome('match', early));
  if (watched.finished) return Promise.resolve(outcome('exit'));
  return new Promise((resolve) => {
    const settle = (reason: WatchWaitReason, matchedLine?: string): void => {
      clearTimeout(timer);
      watched.waiters.delete(onExit);
      unlisten();
      options.signal?.removeEventListener('abort', onAbort);
      resolve(outcome(reason, matchedLine));
    };
    const onExit = (): void => {
      settle('exit');
    };
    const onAbort = (): void => {
      settle('cancelled');
    };
    const unlisten = log.onCommit(() => {
      const line = scan();
      if (line !== undefined) settle('match', line);
    });
    const timer = setTimeout(() => {
      settle('timeout');
    }, options.timeoutMs);
    watched.waiters.add(onExit);
    options.signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Counts waits that ended with nothing new printed, and says so once there are several. */
function idleNote(
  watched: WatchedProcess,
  end: number,
  reason: WatchWaitReason,
): string | undefined {
  if (reason !== 'timeout') {
    watched.idleWaits = 0;
    watched.lastSeenEnd = end;
    return undefined;
  }
  watched.idleWaits = end === watched.lastSeenEnd ? watched.idleWaits + 1 : 1;
  watched.lastSeenEnd = end;
  return watched.idleWaits >= PROCESS_WATCH_IDLE_WAITS_NOTE ? IDLE_NOTE : undefined;
}
