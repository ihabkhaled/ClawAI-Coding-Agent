import { statSync } from 'node:fs';

import { containedPath } from '../core/workspace-containment';

import { clampedInteger } from './command-tool-request';
import {
  PROCESS_WATCH_DEFAULT_OUTPUT_CHARS,
  PROCESS_WATCH_DEFAULT_WAIT_MS,
  PROCESS_WATCH_MAX_ARGUMENTS,
  PROCESS_WATCH_MAX_ARGUMENT_CHARS,
  PROCESS_WATCH_MAX_OUTPUT_CHARS,
  PROCESS_WATCH_MAX_PATTERN_CHARS,
  PROCESS_WATCH_MAX_WAIT_MS,
  PROCESS_WATCH_MIN_OUTPUT_CHARS,
  PROCESS_WATCH_NAME_PATTERN,
  PROCESS_WATCH_NESTED_QUANTIFIER,
  PROCESS_WATCH_WAIT_OUTPUT_CHARS,
} from './process-watch-tool.constants';

import type { WatchRequest } from './process-watch-tool.types';
import type { ToolLimits } from '../headless/headless-main.types';

type ToolArguments = Readonly<Record<string, unknown>>;

/** The `name` argument; every operation but `status` and `list` needs one. */
export function requireName(operation: string, args: ToolArguments): string {
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  if (name.length === 0) throw new Error(`process.watch ${operation} requires a "name" argument.`);
  if (!PROCESS_WATCH_NAME_PATTERN.test(name)) {
    throw new Error(
      '"name" must be 1 to 40 letters, digits, dots, dashes or underscores, starting with a letter or digit.',
    );
  }
  return name;
}

export function optionalName(args: ToolArguments): string | undefined {
  return args.name === undefined || args.name === '' ? undefined : requireName('status', args);
}

export function parseStartRequest(args: ToolArguments, limits: ToolLimits): WatchRequest {
  const executable = typeof args.executable === 'string' ? args.executable.trim() : '';
  if (executable.length === 0) throw new Error('process.watch start requires an "executable".');
  return {
    name: requireName('start', args),
    executable,
    arguments: watchArguments(args.arguments),
    cwd: watchDirectory(args.cwd, limits.workspace),
  };
}

function watchArguments(value: unknown): readonly string[] {
  if (value === undefined) return [];
  const valid =
    Array.isArray(value) &&
    value.length <= PROCESS_WATCH_MAX_ARGUMENTS &&
    value.every(
      (entry) => typeof entry === 'string' && entry.length <= PROCESS_WATCH_MAX_ARGUMENT_CHARS,
    );
  if (!valid) {
    throw new Error(
      `"arguments" must be an array of at most ${String(PROCESS_WATCH_MAX_ARGUMENTS)} strings of at most ${String(PROCESS_WATCH_MAX_ARGUMENT_CHARS)} characters.`,
    );
  }
  return (value as unknown[]).map(String);
}

function watchDirectory(value: unknown, workspace: string): string {
  if (value === undefined || value === '') return workspace;
  if (typeof value !== 'string') throw new Error('"cwd" must be a string.');
  const directory = containedPath(workspace, value);
  let isDirectory = false;
  try {
    isDirectory = statSync(directory).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) throw new Error(`"cwd" ${value} is not a directory in the workspace.`);
  return directory;
}

/** The output budget; `wait` shows less by default because it always reports. */
export function outputLimit(args: ToolArguments, operation: string): number {
  return clampedInteger(args.maxChars, {
    min: PROCESS_WATCH_MIN_OUTPUT_CHARS,
    max: PROCESS_WATCH_MAX_OUTPUT_CHARS,
    fallback:
      operation === 'wait' ? PROCESS_WATCH_WAIT_OUTPUT_CHARS : PROCESS_WATCH_DEFAULT_OUTPUT_CHARS,
  });
}

export function waitTimeout(args: ToolArguments): number {
  return clampedInteger(args.timeoutMs, {
    min: 1,
    max: PROCESS_WATCH_MAX_WAIT_MS,
    fallback: PROCESS_WATCH_DEFAULT_WAIT_MS,
  });
}

/** A cursor argument: a non-negative integer, or undefined when absent. */
export function cursorArgument(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('"sinceCursor" must be a non-negative number: the nextCursor you last saw.');
  }
  return Math.trunc(value);
}

/** The `untilMatch` pattern as a case-insensitive RegExp, refusing shapes that can hang a match. */
export function matchPattern(value: unknown): RegExp | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new Error('"untilMatch" must be a regular expression string.');
  }
  if (value.length > PROCESS_WATCH_MAX_PATTERN_CHARS) {
    throw new Error(
      `"untilMatch" is at most ${String(PROCESS_WATCH_MAX_PATTERN_CHARS)} characters.`,
    );
  }
  if (PROCESS_WATCH_NESTED_QUANTIFIER.test(value)) {
    throw new Error('"untilMatch" has a nested repeat like (a+)+, which can hang; simplify it.');
  }
  try {
    return new RegExp(value, 'iu');
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid';
    throw new Error(`"untilMatch" is not a valid regular expression: ${reason}`);
  }
}
