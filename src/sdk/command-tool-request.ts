import { statSync } from 'node:fs';

import { containedPath } from '../core/workspace-containment';

import {
  COMMAND_DEFAULT_OUTPUT_CHARS,
  COMMAND_DEFAULT_TIMEOUT_MS,
  COMMAND_MAX_ARGUMENTS,
  COMMAND_MAX_ARGUMENT_CHARS,
  COMMAND_MAX_OUTPUT_CHARS,
  COMMAND_MAX_TIMEOUT_MS,
} from './command-tool.constants';

import type { CommandRequest } from './command-tool.types';

type ToolArguments = Readonly<Record<string, unknown>>;

/** A number argument clamped into `[min, max]`, or the default when absent or not a number. */
export function clampedInteger(
  value: unknown,
  bounds: { min: number; max: number; fallback: number },
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return bounds.fallback;
  return Math.min(Math.max(Math.trunc(value), bounds.min), bounds.max);
}

/**
 * Validates `workspace.command.run` arguments. Every problem is named, because
 * the model reads the message and corrects itself on the next turn.
 */
export function parseRunRequest(args: ToolArguments, workspace: string): CommandRequest {
  const executable = typeof args.executable === 'string' ? args.executable.trim() : '';
  if (executable.length === 0) {
    throw new Error('workspace.command run requires an "executable" argument.');
  }
  return {
    executable,
    arguments: commandArguments(args.arguments),
    cwd: commandDirectory(args.cwd, workspace),
    timeoutMs: clampedInteger(args.timeoutMs, {
      min: 1,
      max: COMMAND_MAX_TIMEOUT_MS,
      fallback: COMMAND_DEFAULT_TIMEOUT_MS,
    }),
    maxOutputChars: clampedInteger(args.maxOutputChars, {
      min: 200,
      max: COMMAND_MAX_OUTPUT_CHARS,
      fallback: COMMAND_DEFAULT_OUTPUT_CHARS,
    }),
    background: args.background === true,
  };
}

function commandArguments(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('"arguments" must be an array of strings.');
  if (value.length > COMMAND_MAX_ARGUMENTS) {
    throw new Error(`"arguments" holds at most ${String(COMMAND_MAX_ARGUMENTS)} strings.`);
  }
  return value.map((entry) => {
    if (typeof entry !== 'string' || entry.length > COMMAND_MAX_ARGUMENT_CHARS) {
      throw new Error(
        `Every argument must be a string of at most ${String(COMMAND_MAX_ARGUMENT_CHARS)} characters.`,
      );
    }
    return entry;
  });
}

/** The working directory: inside the workspace, and a directory that exists. */
function commandDirectory(value: unknown, workspace: string): string {
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
