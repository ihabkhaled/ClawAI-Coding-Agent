import { headlessExitCode } from '../core/headless-outcome';
import { createAgent } from '../sdk/create-agent';

import { authFromEnvironment, parseHeadlessArgs } from './headless-args';
import { HEADLESS_USAGE } from './headless-args.constants';
import { writeEvent, writeResult } from './headless-output';

import type { HeadlessEnvironment, HeadlessIo } from './headless-args.types';
import type { RuntimeTransportPort } from '../sdk/agent-sdk.types';

/**
 * The whole non-interactive run, with the process supplied from outside.
 *
 * Returns the exit code rather than exiting, so every path — usage, missing
 * credential, refusal, cancel, success — is testable without spawning. The
 * credential is read from the environment and handed to the SDK; it is never
 * part of anything written.
 */
export async function runHeadlessCli(
  argv: readonly string[],
  environment: HeadlessEnvironment,
  io: HeadlessIo,
  context: { cwd: string; signal?: AbortSignal; transport?: RuntimeTransportPort },
): Promise<number> {
  const parsed = parseHeadlessArgs(argv, environment, context.cwd);
  if (parsed.kind === 'help') {
    io.stdout(HEADLESS_USAGE);
    return 0;
  }
  if (parsed.kind === 'usage') {
    io.stderr(`${parsed.message}\n\n${HEADLESS_USAGE}`);
    return headlessExitCode('unusable');
  }
  const auth = authFromEnvironment(environment);
  if (auth === undefined) {
    io.stderr('No credential: set CLAW_TOKEN, or CLAW_EMAIL and CLAW_PASSWORD.\n');
    return headlessExitCode('unauthenticated');
  }
  const { invocation } = parsed;
  const agent = createAgent({
    auth,
    workspaceRoot: invocation.workspace,
    backendUrl: invocation.backendUrl,
    model: invocation.model,
    provider: invocation.provider,
    permissions: {
      allow: invocation.allowTools,
      allowedExecutables: invocation.allowCommands,
    },
    transport: context.transport,
  });
  const result = await agent.run(invocation.prompt, {
    title: 'Headless run',
    maxTurns: invocation.maxTurns,
    signal: context.signal,
    onEvent: (event) => {
      if (event.type !== 'run.finished') writeEvent(invocation.outputFormat, event, io);
    },
  });
  if (invocation.outputFormat === 'stream-json') {
    writeEvent('stream-json', { type: 'run.finished', result }, io);
  }
  writeResult(invocation.outputFormat, result, io);
  return result.exitCode;
}
