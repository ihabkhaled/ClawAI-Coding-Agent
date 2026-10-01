import { headlessExitCode, outcomeFromError } from '../core/headless-outcome';
import { redactText } from '../core/redaction';
import { AGENT_SDK_DEFAULTS } from '../sdk/agent-sdk.constants';

import { HeadlessTransport } from './headless-transport';

import type { HeadlessEnvironment, HeadlessIo, HeadlessListModels } from './headless-args.types';
import type { HeadlessConnectorModel } from './headless-transport.types';
import type { AgentAuth } from '../sdk/create-agent.types';

/** One line per model: `provider/modelKey`, its display name, and whether it can call tools. */
export function modelLines(models: readonly HeadlessConnectorModel[]): string {
  return models
    .map(
      (model) =>
        `${model.provider}/${model.modelKey}\t${model.displayName}\t${model.supportsTools ? 'tools' : 'no-tools'}`,
    )
    .join('\n');
}

/**
 * `--list-models`: prints the connector models the signed-in account may use and
 * returns the exit code. It starts no run and costs nothing. Text by default,
 * a JSON array with `--json`.
 */
export async function runListModels(
  request: HeadlessListModels,
  auth: AgentAuth | undefined,
  io: HeadlessIo,
  environment: HeadlessEnvironment,
): Promise<number> {
  if (auth === undefined) {
    io.stderr('No credential: set CLAW_TOKEN, or CLAW_EMAIL and CLAW_PASSWORD.\n');
    return headlessExitCode('unauthenticated');
  }
  const transport = new HeadlessTransport(
    request.backendUrl ??
      environment.CLAW_BACKEND_URL ??
      environment.CLAW_LIVE_BACKEND_URL ??
      AGENT_SDK_DEFAULTS.backendUrl,
  );
  try {
    const token = 'token' in auth ? auth.token : await transport.signIn(auth);
    const models = await transport.connectorModels(token);
    io.stdout(request.json ? `${JSON.stringify(models)}\n` : `${modelLines(models)}\n`);
    return 0;
  } catch (error) {
    const outcome = outcomeFromError(error, { aborted: false, signingIn: false });
    io.stderr(`${redactText(error instanceof Error ? error.message : 'Listing models failed')}\n`);
    return headlessExitCode(outcome);
  }
}
