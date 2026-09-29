import { commandSandboxReport, sandboxRefusesCommand } from '../core/command-sandbox';
import { wrapForSandbox } from '../core/command-sandbox-wrappers';

import type {
  CommandLaunch,
  CommandLaunchInput,
  ExecutableResolver,
} from './command-launch-plan.types';

/**
 * Turns a resolved command into what is actually spawned.
 *
 * Without a binding this is the old path, unchanged. With one, the command is
 * wrapped in the chosen mechanism, and the result always carries a report —
 * including `sandbox: 'none'`, so an unconfined run is never silent about it.
 * In docker mode the inner executable is not resolved on the host: it lives in
 * the image, and requiring it on the host would refuse commands the container
 * can run.
 */
export async function planCommandLaunch(
  input: CommandLaunchInput,
  resolve: ExecutableResolver,
): Promise<CommandLaunch> {
  if (input.sandbox === undefined) {
    const executablePath = await resolve(input.executable, input.environment);
    return { executablePath, spawnPath: executablePath, spawnArguments: input.arguments };
  }
  const { plan, workspaceRoot } = input.sandbox;
  const report = commandSandboxReport(plan);
  if (sandboxRefusesCommand(plan.decision))
    throw new Error(`SANDBOX_UNAVAILABLE: ${report.detail}`);
  const mechanism = plan.decision.mechanism;
  if (mechanism === 'none') {
    const executablePath = await resolve(input.executable, input.environment);
    return {
      executablePath,
      spawnPath: executablePath,
      spawnArguments: input.arguments,
      sandbox: report,
    };
  }
  const inner =
    mechanism === 'docker' ? input.executable : await resolve(input.executable, input.environment);
  const wrapped = wrapForSandbox(
    mechanism,
    {
      executable: inner,
      arguments: input.arguments,
      cwd: input.cwd,
      workspaceRoot,
      declaredEnvironment: input.declaredEnvironment,
    },
    plan.host,
    plan.settings,
  );
  const spawnPath = await resolve(wrapped.executable, input.environment);
  return {
    executablePath: mechanism === 'docker' ? spawnPath : inner,
    spawnPath,
    spawnArguments: wrapped.arguments,
    sandbox: report,
  };
}
