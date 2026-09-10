import { resolveExecutable, runBoundedCommand } from './bounded-command-runner';

import type { HookRunResult, HookRunnerPort } from '../services/lifecycle-hook.types';

/**
 * Runs one hook command through the same bounded runner the agent's own
 * commands use: piped stdio, captured and truncated output, no shell.
 *
 * No shell is the important part. A hook is a command and its arguments, not a
 * string handed to `sh -c`, so a path with a space in it cannot become two
 * arguments and a semicolon in a setting cannot become a second command.
 */
export class VscodeHookRunner implements HookRunnerPort {
  constructor(private readonly cwd: () => string | undefined) {}

  async run(
    spec: { command: string; arguments: readonly string[]; timeoutMs: number },
    signal?: AbortSignal,
  ): Promise<HookRunResult> {
    const cwd = this.cwd();
    if (cwd === undefined) return { exitCode: undefined, timedOut: false };
    const executable = await resolveExecutable(spec.command);
    const timeout = new AbortController();
    const timer = setTimeout(() => {
      timeout.abort();
    }, spec.timeoutMs);
    signal?.addEventListener('abort', () => {
      timeout.abort();
    });
    try {
      const result = await runBoundedCommand(executable, [...spec.arguments], cwd, timeout.signal);
      return { exitCode: result.exitCode, timedOut: timeout.signal.aborted };
    } finally {
      clearTimeout(timer);
    }
  }
}
