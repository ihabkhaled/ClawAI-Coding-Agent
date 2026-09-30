import { runCommandSpec } from './bounded-command-runner';
import {
  RUNNER_COMMAND_OUTPUT_LIMIT_BYTES,
  RUNNER_COMMAND_TIMEOUT_MS,
  RUNNER_COMMAND_TARGET_ID,
} from './runner-command-executor.constants';

import type { CommandSandboxPort } from './command-launch-plan.types';
import type { RemoteCommandLoopPorts } from '../services/remote-command-loop.types';

/**
 * Runs a command queued for this machine, confined the way the person asked.
 *
 * Remote commands used to be spawned directly with the editor's whole
 * environment, which meant a runner executed a stranger's queued command with
 * every variable the editor could see and none of the isolation the chat agent
 * gets. This goes through the same launcher as the agent's own commands: the
 * environment is an allow-list, and `clawAI.commandSandbox.mode` decides
 * whether bubblewrap, sandbox-exec or a container wraps the process. A required
 * mechanism that is missing refuses the command instead of running it bare.
 *
 * The report names what actually happened, including "none", so an unconfined
 * run is never silent about it.
 */
export function sandboxedRunnerExecutor(
  sandbox: CommandSandboxPort,
  workspaceRoot: () => string | undefined,
): RemoteCommandLoopPorts['execute'] {
  return async (executable, args, cwd, signal) => {
    const root = workspaceRoot() ?? cwd;
    const result = await runCommandSpec(
      {
        executable,
        arguments: [...args],
        cwdRootKey: 'workspace-root',
        cwd: '.',
        environment: {},
        timeoutMs: RUNNER_COMMAND_TIMEOUT_MS,
        outputLimitBytes: RUNNER_COMMAND_OUTPUT_LIMIT_BYTES,
        expectedEffect: 'local-mutation',
        targetId: RUNNER_COMMAND_TARGET_ID,
        elevation: false,
      },
      cwd,
      signal,
      {},
      sandbox.bind(root),
    );
    return {
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
      ...(result.sandbox === undefined
        ? {}
        : { sandbox: `${result.sandbox.sandbox}: ${result.sandbox.detail}` }),
    };
  };
}
