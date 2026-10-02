import type { ToolLimits } from '../headless/headless-main.types';
import type { ChildProcess } from 'node:child_process';

/** The arguments of `workspace.command.run`, after validation and clamping. */
export interface CommandRequest {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly maxOutputChars: number;
  readonly background: boolean;
}

/** What a finished foreground command reports. */
export interface CommandResult {
  readonly exitCode: number;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  /** Set when the process could not be started, e.g. the executable is not on PATH. */
  readonly error?: string;
}

/** The environment a command may spawn under, injectable so tests need no real machine. */
export interface CommandRuntime {
  readonly platform: NodeJS.Platform;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly exists: (file: string) => boolean;
  /**
   * ADR-143: a routine's secrets, added to the child's environment and to nothing
   * else (not the prompt, not an event). Absent for every ordinary agent.
   */
  readonly secrets?: Readonly<Record<string, string>> | undefined;
}

/** One stream's captured text: head and tail kept, the middle counted. */
export interface CapturedText {
  readonly text: string;
  readonly truncated: boolean;
  readonly omitted: number;
}

/** A spawned process ready to be observed, with the environment it was given. */
export interface SpawnedCommand {
  readonly child: ChildProcess;
  readonly startedAt: number;
}

/** One background process the toolkit is tracking. */
export interface BackgroundProcess {
  readonly processId: string;
  readonly child: ChildProcess;
  readonly startedAt: number;
  /** Characters dropped from the front of the ring buffer so far. */
  droppedChars: number;
  buffer: string;
  exitCode: number | null;
  signal: string | null;
  finished: boolean;
  error: string | undefined;
  readonly waiters: Set<() => void>;
}

/** What the workspace toolkit holds for `workspace.command`. */
export interface CommandTool {
  /** Throws on a refused call; otherwise returns the result, or a promise of it. */
  readonly execute: (
    operation: string,
    args: Readonly<Record<string, unknown>>,
    limits: ToolLimits,
    signal?: AbortSignal,
  ) => unknown;
  /** Kills every background process still alive. */
  readonly dispose: () => void;
}
