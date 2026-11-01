import { runCommandSpec } from '../infrastructure/bounded-command-runner';

import type { CommandResult } from '../core/command-spec';

/** Runs `gh` or `git` in a workspace folder, bounded in time and output. */
export function runPullRequestCommand(
  executable: string,
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<CommandResult> {
  return runCommandSpec(
    {
      executable,
      arguments: [...args],
      cwdRootKey: 'internal',
      cwd: '.',
      environment: {},
      timeoutMs: 120_000,
      outputLimitBytes: 4_194_304,
      expectedEffect: 'network',
      targetId: 'target:workspace',
      elevation: false,
    },
    cwd,
    signal,
  );
}
