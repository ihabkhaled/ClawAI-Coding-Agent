import { headlessExitCode } from '../core/headless-outcome';
import { AGENT_SDK_DEFAULTS } from '../sdk/agent-sdk.constants';
import { createAgent } from '../sdk/create-agent';

import { agentConfigFor } from './headless-agent-config';
import { authFromEnvironment, parseHeadlessArgs } from './headless-args';
import { HEADLESS_USAGE } from './headless-args.constants';
import { resolveHeadlessInputs } from './headless-inputs';
import { writeEvent, writeResult } from './headless-output';
import { fileSessionStore } from './headless-session-store';
import { runMcpLogin } from './mcp/mcp-login-command';

import type { HeadlessEnvironment, HeadlessInvocation, HeadlessIo } from './headless-args.types';
import type { HeadlessSessionStore } from './headless-session-store.types';
import type { McpLoginContext } from './mcp/mcp-login.types';
import type { RuntimeTransportPort } from '../sdk/agent-sdk.types';

interface HeadlessContext {
  readonly cwd: string;
  readonly signal?: AbortSignal;
  readonly transport?: RuntimeTransportPort;
  /** Where `--continue` finds the last thread; defaults to a file under the state directory. */
  readonly sessions?: HeadlessSessionStore;
  /** Opens a URL in a browser; supplied by the process only when a terminal is attached. */
  readonly openUrl?: (url: string) => void;
  /** Overrides for `--mcp-login`, so a test can reach a local authorization server. */
  readonly login?: Partial<McpLoginContext>;
}

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
  context: HeadlessContext,
): Promise<number> {
  const parsed = parseHeadlessArgs(argv, environment, context.cwd);
  if (parsed.kind === 'help') {
    io.stdout(HEADLESS_USAGE);
    return 0;
  }
  if (parsed.kind === 'usage') return usageError(io, parsed.message);
  if (parsed.kind === 'login') {
    return runMcpLogin(parsed.login, environment, io, {
      cwd: context.cwd,
      signal: context.signal,
      openUrl: context.openUrl,
      ...context.login,
    });
  }
  const auth = authFromEnvironment(environment);
  if (auth === undefined) {
    io.stderr('No credential: set CLAW_TOKEN, or CLAW_EMAIL and CLAW_PASSWORD.\n');
    return headlessExitCode('unauthenticated');
  }
  const { invocation } = parsed;
  const inputs = await resolveHeadlessInputs(invocation, context.cwd);
  if (!inputs.ok) return usageError(io, inputs.message);
  const sessions = context.sessions ?? fileSessionStore(environment);
  const scope = {
    backendUrl: invocation.backendUrl ?? AGENT_SDK_DEFAULTS.backendUrl,
    workspace: invocation.workspace,
  };
  const threadId = await threadToResume(invocation, sessions, scope);
  if (threadId === null) return usageError(io, 'There is no previous thread to --continue.');
  const agent = createAgent(
    agentConfigFor({
      invocation,
      inputs,
      auth,
      threadId,
      environment,
      io,
      transport: context.transport,
    }),
  );
  const result = await agent.run(invocation.prompt, {
    title: 'Headless run',
    maxTurns: invocation.maxTurns,
    maxToolCalls: invocation.maxToolCalls,
    maxDurationMs: invocation.maxDurationMs,
    signal: context.signal,
    onEvent: (event) => {
      if (event.type !== 'run.finished') writeEvent(invocation.outputFormat, event, io);
    },
  });
  if (result.threadId !== undefined) await sessions.remember(scope, result.threadId);
  if (invocation.outputFormat === 'stream-json') {
    writeEvent('stream-json', { type: 'run.finished', result }, io);
  }
  writeResult(invocation.outputFormat, result, io);
  return result.exitCode;
}

function usageError(io: HeadlessIo, message: string): number {
  io.stderr(`${message}\n\n${HEADLESS_USAGE}`);
  return headlessExitCode('unusable');
}

/** The thread to continue, undefined for a fresh one, or null when `--continue` has nothing. */
async function threadToResume(
  invocation: HeadlessInvocation,
  sessions: HeadlessSessionStore,
  scope: { backendUrl: string; workspace: string },
): Promise<string | undefined | null> {
  if (invocation.continueLast !== true) return invocation.resume;
  return (await sessions.latest(scope)) ?? null;
}
