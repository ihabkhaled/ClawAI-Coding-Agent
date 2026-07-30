import { spawn } from 'node:child_process';

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
