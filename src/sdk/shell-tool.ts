import { statSync } from 'node:fs';

import { containedPath } from '../core/workspace-containment';

import { systemCommandRuntime } from './command-tool';
import { clampedInteger } from './command-tool-request';
import { availableShells, findDefaultShell, findShell } from './shell-detect';
import { appendShellLog, prepareShellLog } from './shell-log';
import { ShellRefusalError } from './shell-refusal-error';
import { compileDenyRule, screenContext, screenScript } from './shell-screen';
import { runShell } from './shell-tool-run';
import { scopeShellTool } from './shell-tool-scope';
import {
  SHELL_DEFAULT_TIMEOUT_MS,
  SHELL_KINDS,
  SHELL_MAX_DENY_CHARS,
  SHELL_MAX_DENY_RULES,
  SHELL_MAX_SCRIPT_CHARS,
  SHELL_MAX_TIMEOUT_MS,
  SHELL_NO_SHELL_MESSAGE,
} from './shell-tool.constants';

import type { CommandRuntime } from './command-tool.types';
import type {
  ResolvedShell,
  ShellKind,
  ShellOptions,
  ShellRefusal,
  ShellRequest,
  ShellTool,
} from './shell-tool.types';
import type { WriteScope } from './write-scope.types';

type ToolArguments = Readonly<Record<string, unknown>>;

/** The problem with `--shell-deny` sources, or undefined when every one compiles. */
export function shellDenyProblem(sources: readonly string[]): string | undefined {
  if (sources.length > SHELL_MAX_DENY_RULES) {
    return `--shell-deny takes at most ${String(SHELL_MAX_DENY_RULES)} patterns.`;
  }
  for (const source of sources) {
    if (source.length === 0 || source.length > SHELL_MAX_DENY_CHARS) {
      return `--shell-deny patterns must be 1 to ${String(SHELL_MAX_DENY_CHARS)} characters.`;
    }
    const compiled = compileDenyRule(source);
    if (typeof compiled === 'string') return compiled;
  }
  return undefined;
}

function isShellKind(value: string): value is ShellKind {
  return SHELL_KINDS.some((kind) => kind === value);
}

function directoryFor(value: unknown, workspace: string): string {
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

/** Validates `workspace.shell.run` arguments; every problem is named, the model reads it. */
export function parseShellRequest(args: ToolArguments, workspace: string): ShellRequest {
  const script = typeof args.script === 'string' ? args.script : '';
  if (script.trim().length === 0) throw new Error('workspace.shell run requires a "script".');
  if (script.includes('\u0000')) {
    throw new Error('"script" may not contain a NUL character.');
  }
  if (script.length > SHELL_MAX_SCRIPT_CHARS) {
    throw new Error(
      `"script" is at most ${String(SHELL_MAX_SCRIPT_CHARS)} characters; put long logic in a file with workspace.file and run that.`,
    );
  }
  const shell = args.shell;
  if (shell !== undefined && (typeof shell !== 'string' || !isShellKind(shell))) {
    throw new Error(`"shell" must be one of ${SHELL_KINDS.join(', ')}.`);
  }
  return {
    script,
    shell,
    cwd: directoryFor(args.cwd, workspace),
    timeoutMs: clampedInteger(args.timeoutMs, {
      min: 1,
      max: SHELL_MAX_TIMEOUT_MS,
      fallback: SHELL_DEFAULT_TIMEOUT_MS,
    }),
  };
}

function chosenShell(request: ShellRequest, runtime: CommandRuntime): ResolvedShell {
  if (request.shell !== undefined) {
    const found = findShell(request.shell, runtime);
    if (found !== undefined) return found;
    const have = availableShells(runtime);
    throw new Error(
      have.length === 0
        ? SHELL_NO_SHELL_MESSAGE
        : `workspace.shell: ${request.shell} is not installed here. Available: ${have.join(', ')}.`,
    );
  }
  const found = findDefaultShell(runtime);
  if (found === undefined) throw new Error(SHELL_NO_SHELL_MESSAGE);
  return found;
}

/**
 * The shell tool for one toolkit.
 *
 * Validation and the screen throw before anything is spawned, so a refused
 * script costs no process, and `screen` lets the toolkit refuse BEFORE the
 * operator is asked to approve something that would be refused anyway. With a
 * write scope the change detection wraps the run, and the log is written
 * OUTSIDE it: a state directory beside the workspace must not read as an escape.
 */
export function createShellTool(
  options: ShellOptions,
  scope?: WriteScope,
  runtime: CommandRuntime = systemCommandRuntime(),
): ShellTool {
  prepareShellLog(options.logDirectory);
  const core = shellCore(options.deny ?? [], runtime);
  return withLog(scope === undefined ? core : scopeShellTool(core, scope), options.logDirectory);
}

function shellCore(denySources: readonly string[], runtime: CommandRuntime): ShellTool {
  const deny = denySources.flatMap((source) => {
    const compiled = compileDenyRule(source);
    return typeof compiled === 'string' ? [] : [compiled];
  });
  const refusalFor = (request: ShellRequest, workspace: string): ShellRefusal | undefined =>
    screenScript(request.script, screenContext(workspace, request.cwd, runtime.platform), deny);
  return {
    screen: (args, workspace) => {
      try {
        return refusalFor(parseShellRequest(args, workspace), workspace)?.message;
      } catch (error) {
        return error instanceof Error ? error.message : 'workspace.shell: invalid call.';
      }
    },
    execute: async (operation, args, workspace, signal) => {
      if (operation !== 'run') throw new Error(`Unsupported operation ${operation}`);
      const request = parseShellRequest(args, workspace);
      const refusal = refusalFor(request, workspace);
      if (refusal !== undefined) throw new ShellRefusalError(refusal);
      return runShell(chosenShell(request, runtime), request, runtime, signal);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Records every script, run or refused, after everything else has judged it. */
function withLog(inner: ShellTool, directory: string | undefined): ShellTool {
  return {
    screen: inner.screen,
    execute: async (operation, args, workspace, signal) => {
      const script = typeof args.script === 'string' ? args.script : '';
      const cwd = typeof args.cwd === 'string' ? args.cwd : '.';
      try {
        const result = await inner.execute(operation, args, workspace, signal);
        if (isRecord(result)) {
          appendShellLog(directory, {
            shell: typeof result.shell === 'string' ? result.shell : undefined,
            cwd,
            script,
            ...(typeof result.exitCode === 'number' ? { exitCode: result.exitCode } : {}),
            ...(typeof result.timedOut === 'boolean' ? { timedOut: result.timedOut } : {}),
            ...(typeof result.durationMs === 'number' ? { durationMs: result.durationMs } : {}),
          });
        }
        return result;
      } catch (error) {
        appendShellLog(directory, {
          shell: typeof args.shell === 'string' ? args.shell : undefined,
          cwd,
          script,
          ...(error instanceof ShellRefusalError
            ? { refusedBy: error.rule }
            : { error: error instanceof Error ? error.message.slice(0, 300) : 'failed' }),
        });
        throw error;
      }
    },
  };
}
