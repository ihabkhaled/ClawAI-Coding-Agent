import type { AgentToolCall } from './agent-sdk.types';
import type { CommandRuntime } from './command-tool.types';
import type { ToolLimits } from '../headless/headless-main.types';
import type { ChildProcess } from 'node:child_process';

/** What one read of a process log reports. */
export interface LogSlice {
  readonly output: string;
  /** Pass back as `sinceCursor` to read only what arrives after this slice. */
  readonly nextCursor: number;
  /** Where this slice began, in the same units. */
  readonly fromCursor: number;
  readonly truncated: boolean;
  readonly omittedChars: number;
  /** True when the requested cursor was older than what the memory ring still holds. */
  readonly droppedEarlier: boolean;
}

/** The first line at or after a position that a pattern matched. */
export interface LogMatch {
  readonly line: string;
  /** Position just past the matched line. */
  readonly end: number;
}

/** Why a `wait` returned. */
export type WatchWaitReason = 'exit' | 'match' | 'timeout' | 'cancelled';

/** One process the registry is tracking. */
export interface WatchedProcess {
  readonly name: string;
  readonly command: string;
  readonly child: ChildProcess;
  readonly startedAt: number;
  readonly pid: number | undefined;
  finished: boolean;
  finishedAt: number | undefined;
  exitCode: number | null;
  signal: string | null;
  stopRequested: boolean;
  error: string | undefined;
  /** The log position when the last wait returned. */
  lastSeenEnd: number;
  idleWaits: number;
  readonly waiters: Set<() => void>;
}

/** The inputs of one registry. */
export interface ProcessWatchOptions {
  readonly runtime: CommandRuntime;
  readonly maxConcurrent?: number;
  readonly memoryChars?: number;
  readonly fileBytes?: number;
  /** Directory under which the per-run log folder is made; defaults to the OS temp dir. */
  readonly logRoot?: string;
}

/** What the toolkit holds for `process.watch`. */
export interface ProcessWatchTool {
  readonly execute: (
    operation: string,
    args: Readonly<Record<string, unknown>>,
    limits: ToolLimits,
    signal?: AbortSignal,
  ) => unknown;
  /** Kills every process still alive and removes the logs. */
  readonly dispose: () => void;
}

/** A call as the scope wrapper sees it. */
export type WatchCall = Pick<AgentToolCall, 'operation' | 'arguments'>;

/** The arguments of `process.watch start`, validated. */
export interface WatchRequest {
  readonly name: string;
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
}

/** A line test that cannot hang the host: `tooSlow` is set once the pattern exceeded its time budget. */
export interface LinePattern {
  test(line: string): boolean;
  readonly tooSlow?: boolean;
}
