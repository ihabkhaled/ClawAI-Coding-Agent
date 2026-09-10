import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import spawn from 'cross-spawn';

import { BoundedOutputBuffer } from '../core/bounded-output';
import { commandSpecSchema, type CommandResult, type CommandSpec } from '../core/command-spec';
import { inheritedEnvironment } from '../core/inherited-environment';
import { INHERITED_ENVIRONMENT_KEYS } from '../core/inherited-environment.constants';
import { redactText } from '../core/redaction';

import { terminateProcess } from './process-terminator';

import type { ProcessTerminationHandle } from './process-terminator.types';
import type { CommandExecutionResult } from '../services/agent-run-service.types';
import type { ChildProcess, ChildProcessWithoutNullStreams } from 'node:child_process';

// cross-spawn's type declarations always return the general `ChildProcess`
// shape, unlike node:child_process's own overloads which narrow to
// `ChildProcessWithoutNullStreams` when `stdio` is omitted. We never pass a
// `stdio` option, so the streams are always piped at runtime; this asserts
// that instead of forcing it with `!`.
function assertPipedStdio(child: ChildProcess): asserts child is ChildProcessWithoutNullStreams {
  if (child.stdout === null || child.stderr === null || child.stdin === null) {
    throw new Error('Spawned process did not provide piped stdio.');
  }
}

export function runBoundedCommand(
  executable: string,
  arguments_: string[],
  cwd: string,
  signal: AbortSignal,
): Promise<CommandExecutionResult> {
  const startedAt = Date.now();
  const outputLimit = 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, { cwd, shell: false, windowsHide: true });
    assertPipedStdio(child);
    // Same head-and-tail rule as the structured runner: a development command
    // that overruns is almost always one that failed, and the reason is at the
    // end. Decoding once at the end also stops a multi-byte character being
    // split across two chunk boundaries.
    const half = Math.max(1, Math.floor(outputLimit / 2));
    const buffers = {
      stdout: new BoundedOutputBuffer(outputLimit - half),
      stderr: new BoundedOutputBuffer(half),
    };
    child.stdout.on('data', (chunk: Buffer) => {
      buffers.stdout.append(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      buffers.stderr.append(chunk);
    });
    let termination: ProcessTerminationHandle | null = null;
    const terminate = (): void => {
      termination ??= terminateProcess(child);
    };
    const timeout = setTimeout(terminate, 5 * 60_000);
    const cleanup = (): void => {
      clearTimeout(timeout);
      termination?.settle();
      signal.removeEventListener('abort', aborted);
    };
    const aborted = (): void => {
      terminate();
      cleanup();
      reject(new Error('ClawAI command execution was cancelled.'));
    };
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('close', (exitCode) => {
      cleanup();
      const stdout = buffers.stdout.result();
      const stderr = buffers.stderr.result();
      resolve({
        exitCode: exitCode ?? undefined,
        stdout: redactText(stdout.text),
        stderr: redactText(stderr.text),
        durationMs: Date.now() - startedAt,
        truncated: stdout.truncated || stderr.truncated,
      });
    });
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

/** Re-exported from its canonical home so existing callers keep one import. */
export const inheritedEnvironmentKeys = INHERITED_ENVIRONMENT_KEYS;

function boundedEnvironment(additions: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  return inheritedEnvironment(process.env, additions);
}

export async function resolveExecutable(
  executable: string,
  environment: NodeJS.ProcessEnv = boundedEnvironment({}),
): Promise<string> {
  const hasPath =
    path.isAbsolute(executable) || executable.includes('/') || executable.includes('\\');
  const extensions =
    process.platform === 'win32' ? (environment.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : [''];
  const candidates = hasPath
    ? [executable]
    : (environment.PATH ?? environment.Path ?? '')
        .split(path.delimiter)
        .flatMap((directory) =>
          extensions.map((extension) => path.join(directory, `${executable}${extension}`)),
        );
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return path.resolve(candidate);
    } catch {
      // Continue searching the explicit PATH snapshot.
    }
  }
  throw new Error(`Executable was not found: ${executable}`);
}

function shellArguments(specification: CommandSpec): readonly string[] {
  const shell = specification.shell;
  if (shell === undefined) return specification.arguments;
  if (shell.dialect === 'cmd') return ['/d', '/s', '/c', shell.command];
  if (shell.dialect === 'powershell' || shell.dialect === 'pwsh')
    return ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', shell.command];
  return ['-c', shell.command];
}

export async function runCommandSpec(
  candidate: unknown,
  cwd: string,
  signal?: AbortSignal,
  trustedEnvironment: Readonly<Record<string, string>> = {},
): Promise<CommandResult> {
  const specification = commandSpecSchema.parse(candidate);
  if (specification.elevation) throw new Error('ELEVATION_NOT_AVAILABLE');
  const environment = boundedEnvironment(specification.environment);
  for (const [key, value] of Object.entries(trustedEnvironment)) environment[key] = value;
  const executablePath = await resolveExecutable(specification.executable, environment);
  const executableHash = `sha256:${createHash('sha256')
    .update(await readFile(executablePath))
    .digest('hex')}`;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, shellArguments(specification), {
      cwd,
      env: environment,
      shell: false,
      windowsHide: true,
    });
    assertPipedStdio(child);
    // One budget, split between the streams, so a chatty stdout cannot starve
    // the stderr that usually carries the reason a command failed.
    const half = Math.max(1, Math.floor(specification.outputLimitBytes / 2));
    const buffers = {
      stdout: new BoundedOutputBuffer(specification.outputLimitBytes - half),
      stderr: new BoundedOutputBuffer(half),
    };
    let timedOut = false;
    let cancelled = false;
    child.stdout.on('data', (chunk: Buffer) => {
      buffers.stdout.append(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      buffers.stderr.append(chunk);
    });
    if (specification.stdin !== undefined) child.stdin.end(specification.stdin);
    else child.stdin.end();
    let termination: ProcessTerminationHandle | null = null;
    const terminate = (): void => {
      termination ??= terminateProcess(child);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, specification.timeoutMs);
    const aborted = (): void => {
      cancelled = true;
      terminate();
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      termination?.settle();
      signal?.removeEventListener('abort', aborted);
    };
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('close', (exitCode, closeSignal) => {
      cleanup();
      const stdout = buffers.stdout.result();
      const stderr = buffers.stderr.result();
      resolve({
        executablePath,
        executableHash,
        stdout: redactText(stdout.text),
        stderr: redactText(stderr.text),
        exitCode,
        signal: closeSignal,
        startedAt,
        durationMs: Date.now() - startedAtMs,
        timedOut,
        cancelled,
        truncated: stdout.truncated || stderr.truncated,
        forciblyTerminated: termination?.wasForced() ?? false,
      });
    });
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted === true) aborted();
  });
}
