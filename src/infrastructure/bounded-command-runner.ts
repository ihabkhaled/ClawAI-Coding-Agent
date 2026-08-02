import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { commandSpecSchema, type CommandResult, type CommandSpec } from '../core/command-spec';
import { redactText } from '../core/redaction';

import type { CommandExecutionResult } from '../services/agent-run-service.types';

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
    let stdout = '';
    let stderr = '';
    let truncated = false;
    const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      const remaining = Math.max(0, outputLimit - stdout.length - stderr.length);
      const value = chunk.toString('utf8');
      const bounded = value.slice(0, remaining);
      truncated ||= bounded.length < value.length;
      if (target === 'stdout') stdout += bounded;
      else stderr += bounded;
    };
    child.stdout.on('data', (chunk: Buffer) => {
      append('stdout', chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      append('stderr', chunk);
    });
    const timeout = setTimeout(() => child.kill(), 5 * 60_000);
    const cleanup = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', aborted);
    };
    const aborted = (): void => {
      child.kill();
      cleanup();
      reject(new Error('ClawAI command execution was cancelled.'));
    };
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('close', (exitCode) => {
      cleanup();
      resolve({
        exitCode: exitCode ?? undefined,
        stdout: redactText(stdout),
        stderr: redactText(stderr),
        durationMs: Date.now() - startedAt,
        truncated,
      });
    });
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

const inheritedEnvironmentKeys = [
  'PATH',
  'Path',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'LANG',
  'LC_ALL',
] as const;

function boundedEnvironment(additions: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of inheritedEnvironmentKeys) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  for (const [key, value] of Object.entries(additions)) environment[key] = value;
  return environment;
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
    const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[], bytes: 0 };
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
    const append = (channel: 'stdout' | 'stderr', chunk: Buffer): void => {
      const remaining = Math.max(0, specification.outputLimitBytes - chunks.bytes);
      const bounded = chunk.subarray(0, remaining);
      chunks[channel].push(bounded);
      chunks.bytes += bounded.byteLength;
      truncated ||= bounded.byteLength !== chunk.byteLength;
    };
    child.stdout.on('data', (chunk: Buffer) => {
      append('stdout', chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      append('stderr', chunk);
    });
    if (specification.stdin !== undefined) child.stdin.end(specification.stdin);
    else child.stdin.end();
    const terminate = (): void => {
      if (process.platform === 'win32') child.kill();
      else child.kill('SIGTERM');
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
      signal?.removeEventListener('abort', aborted);
    };
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('close', (exitCode, closeSignal) => {
      cleanup();
      resolve({
        executablePath,
        executableHash,
        stdout: redactText(Buffer.concat(chunks.stdout).toString('utf8')),
        stderr: redactText(Buffer.concat(chunks.stderr).toString('utf8')),
        exitCode,
        signal: closeSignal,
        startedAt,
        durationMs: Date.now() - startedAtMs,
        timedOut,
        cancelled,
        truncated,
      });
    });
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted === true) aborted();
  });
}
