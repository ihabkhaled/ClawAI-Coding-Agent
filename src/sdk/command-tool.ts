import { existsSync, statSync } from 'node:fs';
import { env, platform } from 'node:process';

import { isAllowedExecutable } from '../headless/headless-command-policy';

import { BackgroundCommands } from './command-tool-background';
import { runForeground } from './command-tool-foreground';
import {
  disallowedCommandMessage,
  shellSyntaxArgument,
  shellSyntaxMessage,
} from './command-tool-hints';
import { clampedInteger, parseRunRequest } from './command-tool-request';
import {
  COMMAND_DEFAULT_OUTPUT_CHARS,
  COMMAND_MAX_OUTPUT_CHARS,
  COMMAND_MAX_WAIT_MS,
} from './command-tool.constants';

import type { CommandTool, CommandRuntime } from './command-tool.types';
import type { ToolLimits } from '../headless/headless-main.types';

type ToolArguments = Readonly<Record<string, unknown>>;

/** The real machine: this process's platform and environment, and files that exist. */
export function systemCommandRuntime(): CommandRuntime {
  return {
    platform,
    environment: env,
    exists: (file) => {
      try {
        return existsSync(file) && statSync(file).isFile();
      } catch {
        return false;
      }
    },
  };
}

/**
 * The command tool for one toolkit: foreground runs, and the background
 * processes they may start.
 *
 * Validation and the allowlist check throw before anything is spawned, so a
 * refused call never costs a process. What `execute` returns for a real run is
 * a promise, because a command may take half an hour and the run loop that
 * also handles cancellation must stay free while it does.
 */
export function createCommandTool(runtime: CommandRuntime = systemCommandRuntime()): CommandTool {
  const background = new BackgroundCommands(runtime);
  return {
    execute: (operation, args, limits, signal) => {
      if (operation === 'run') return run(args, limits, runtime, background, signal);
      const processId = requireProcessId(operation, args);
      const limit = clampedInteger(args.maxOutputChars, {
        min: 200,
        max: COMMAND_MAX_OUTPUT_CHARS,
        fallback: COMMAND_DEFAULT_OUTPUT_CHARS,
      });
      if (operation === 'output') {
        return background.output(processId, sinceOffset(args.sinceOffset), limit);
      }
      if (operation === 'wait') {
        const timeoutMs = clampedInteger(args.timeoutMs, {
          min: 1,
          max: COMMAND_MAX_WAIT_MS,
          fallback: 60_000,
        });
        return background.wait(processId, timeoutMs, limit, signal);
      }
      if (operation === 'stop') return background.stop(processId, limit);
      throw new Error(`Unsupported operation ${operation}`);
    },
    dispose: () => {
      background.disposeAll();
    },
  };
}

function run(
  args: ToolArguments,
  limits: ToolLimits,
  runtime: CommandRuntime,
  background: BackgroundCommands,
  signal: AbortSignal | undefined,
): unknown {
  const request = parseRunRequest(args, limits.workspace);
  if (!isAllowedExecutable(request.executable, limits.allowedExecutables)) {
    throw new Error(disallowedCommandMessage(request.executable, limits.allowedExecutables));
  }
  const shellToken = shellSyntaxArgument(request.arguments);
  if (shellToken !== undefined) throw new Error(shellSyntaxMessage(shellToken));
  return request.background ? background.start(request) : runForeground(request, runtime, signal);
}

function requireProcessId(operation: string, args: ToolArguments): string {
  if (typeof args.processId === 'string' && args.processId.length > 0) return args.processId;
  throw new Error(`workspace.command ${operation} requires a "processId" argument.`);
}

function sinceOffset(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(Math.trunc(value), 0) : 0;
}
