import { redactJobSecretsDeep } from '../core/job-secrets';

import { systemCommandRuntime } from './command-tool';

import type { CommandRuntime, CommandTool } from './command-tool.types';
import type { JobSecretEnvironment } from '../core/job-secrets.types';

/**
 * The runtime a routine's command tool spawns under: this machine, plus the
 * routine's secrets as environment variables of the child process only.
 */
export function secretCommandRuntime(secrets: JobSecretEnvironment): CommandRuntime {
  return { ...systemCommandRuntime(), secrets };
}

/**
 * A command tool whose results never carry a secret value. A command that
 * prints its environment would otherwise hand the value to the model, and the
 * model's transcript to the server.
 */
export function redactingCommandTool(
  tool: CommandTool,
  secrets: JobSecretEnvironment,
): CommandTool {
  const scrub = (result: unknown): unknown =>
    result instanceof Promise
      ? result.then((value: unknown) => redactJobSecretsDeep(value, secrets))
      : redactJobSecretsDeep(result, secrets);
  return {
    execute: (operation, args, limits, signal) =>
      scrub(tool.execute(operation, args, limits, signal)),
    dispose: () => {
      tool.dispose();
    },
  };
}
