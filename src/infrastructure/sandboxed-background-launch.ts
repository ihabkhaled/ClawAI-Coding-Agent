import { resolveExecutable, type BackgroundLaunchPlan } from './bounded-command-runner';
import { planCommandLaunch } from './command-launch-plan';
import { realPath } from './command-sandbox-host-probe';

import type { CommandSandboxBinding, SandboxedBackgroundLaunch } from './command-launch-plan.types';
import type { CommandSpec } from '../core/command-spec';

/**
 * The background launch, confined the same way a foreground one would be.
 *
 * Without this a sandbox would cover `npm test` and not `npm run dev`, and the
 * command that runs longest would be the one that escapes it.
 */
export async function sandboxBackgroundLaunch(
  plan: BackgroundLaunchPlan,
  specification: CommandSpec,
  cwd: string,
  binding: CommandSandboxBinding | undefined,
): Promise<SandboxedBackgroundLaunch> {
  if (binding === undefined)
    return {
      executablePath: plan.executablePath,
      arguments: plan.arguments,
      environment: plan.environment,
      cwd,
    };
  const confinedCwd = realPath(cwd);
  const launch = await planCommandLaunch(
    {
      executable: specification.executable,
      arguments: plan.arguments,
      cwd: confinedCwd,
      environment: plan.environment,
      declaredEnvironment: specification.environment,
      sandbox: binding,
    },
    resolveExecutable,
  );
  return {
    executablePath: launch.spawnPath,
    arguments: launch.spawnArguments,
    environment: plan.environment,
    cwd: confinedCwd,
    ...(launch.sandbox === undefined ? {} : { sandbox: launch.sandbox }),
  };
}
