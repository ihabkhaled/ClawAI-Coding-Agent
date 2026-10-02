import { spawn } from 'node:child_process';

import { hardenedGitEnvironment } from '../core/git-hardening';
import { redactText } from '../core/redaction';

import { splitBudget } from './command-tool-foreground';
import { StreamCapture } from './command-tool-output';
import { commandEnvironment, killCommandTree } from './command-tool-spawn';
import { COMMAND_EXIT_SETTLE_MS } from './command-tool.constants';
import { SHELL_FIXED_ENVIRONMENT, SHELL_OUTPUT_CHARS } from './shell-tool.constants';

import type { CommandRuntime } from './command-tool.types';
import type { ResolvedShell, ShellRequest, ShellResult } from './shell-tool.types';

/**
 * The environment a script sees: the command tool's filtered one (no secrets),
 * git hardened the way every git call here is, and settings that stop a script
 * waiting for a person.
 */
export function shellEnvironment(runtime: CommandRuntime): Record<string, string> {
  return {
    ...hardenedGitEnvironment(commandEnvironment(runtime.environment, runtime.platform)),
    ...SHELL_FIXED_ENVIRONMENT,
  };
}

/**
 * Runs one script to completion without blocking the event loop.
 *
 * Stdin is closed. A timeout or the run's abort signal kills the whole process
 * tree (taskkill /T on Windows, the process group elsewhere). The result
 * settles exactly once, on `close` or shortly after `exit` if something the
 * script left behind still holds a pipe.
 */
export function runShell(
  shell: ResolvedShell,
  request: ShellRequest,
  runtime: CommandRuntime,
  signal: AbortSignal | undefined,
): Promise<ShellResult> {
  if (signal?.aborted === true) {
    throw new Error('The run was cancelled before the script started.');
  }
  const child = spawn(shell.file, [...shell.argumentsFor(request.script)], {
    cwd: request.cwd,
    env: shellEnvironment(runtime),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: shell.verbatim,
    detached: runtime.platform !== 'win32',
  });
  const startedAt = Date.now();
  const stdout = new StreamCapture(SHELL_OUTPUT_CHARS);
  const stderr = new StreamCapture(SHELL_OUTPUT_CHARS);
  return new Promise<ShellResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let aborted = false;
    const timers: NodeJS.Timeout[] = [];
    const onAbort = (): void => {
      aborted = true;
      killCommandTree(child, runtime.platform);
    };
    const finish = (exitCode: number | null, exitSignal: string | null, error?: string): void => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const [outBudget, errBudget] = splitBudget(
        stdout.length(),
        stderr.length(),
        SHELL_OUTPUT_CHARS,
      );
      const out = stdout.result(outBudget);
      const err = stderr.result(errBudget);
      resolve({
        shell: shell.kind,
        exitCode: exitCode ?? -1,
        signal: exitSignal,
        timedOut,
        aborted,
        durationMs: Date.now() - startedAt,
        stdout: redactText(out.text),
        stderr: redactText(err.text),
        truncated: out.truncated || err.truncated,
        ...(error === undefined ? {} : { error }),
      });
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on('error', (error) => {
      finish(null, null, error.message);
    });
    child.on('exit', (code, exitSignal) => {
      timers.push(
        setTimeout(() => {
          finish(code, exitSignal);
        }, COMMAND_EXIT_SETTLE_MS),
      );
    });
    child.on('close', (code, exitSignal) => {
      finish(code, exitSignal);
    });
    timers.push(
      setTimeout(() => {
        if (child.exitCode !== null) return;
        timedOut = true;
        killCommandTree(child, runtime.platform);
      }, request.timeoutMs),
    );
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
