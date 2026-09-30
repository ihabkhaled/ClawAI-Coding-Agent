import { StreamCapture } from './command-tool-output';
import { killCommandTree, launchCommand } from './command-tool-spawn';
import { COMMAND_EXIT_SETTLE_MS } from './command-tool.constants';

import type { CommandRequest, CommandResult, CommandRuntime } from './command-tool.types';

/**
 * Splits one budget between two streams.
 *
 * Both fit as they are when they can; otherwise the smaller stream keeps what
 * it needs and the other gets the rest, so a quiet stderr does not waste half
 * the budget while stdout is cut. The two together stay under the one limit,
 * which is what keeps a result well inside what a model turn can carry.
 */
export function splitBudget(
  first: number,
  second: number,
  budget: number,
): readonly [number, number] {
  if (first + second <= budget) return [budget, budget];
  const half = Math.floor(budget / 2);
  if (first <= half) return [first, budget - first];
  if (second <= half) return [budget - second, second];
  return [half, half];
}

/**
 * Runs a command to completion without blocking the event loop.
 *
 * It settles exactly once: on `close` once the pipes drain, or shortly after
 * `exit` if something the command left behind still holds a pipe open. A
 * timeout or the run's abort signal kills the whole tree and the result says
 * which one it was.
 */
export function runForeground(
  request: CommandRequest,
  runtime: CommandRuntime,
  signal: AbortSignal | undefined,
): Promise<CommandResult> {
  if (signal?.aborted === true)
    throw new Error('The run was cancelled before the command started.');
  const child = launchCommand(request, runtime);
  const startedAt = Date.now();
  const stdout = new StreamCapture(request.maxOutputChars);
  const stderr = new StreamCapture(request.maxOutputChars);
  return new Promise<CommandResult>((resolve) => {
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
        request.maxOutputChars,
      );
      const out = stdout.result(outBudget);
      const err = stderr.result(errBudget);
      resolve({
        exitCode: exitCode ?? -1,
        signal: exitSignal,
        timedOut,
        aborted,
        durationMs: Date.now() - startedAt,
        stdout: out.text,
        stderr: err.text,
        truncated: out.truncated || err.truncated,
        ...(error === undefined ? {} : { error }),
      });
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
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
