/**
 * Type-level smoke test of the SDK's public surface.
 *
 * Compiled, never run: `tests/unit/sdk-types-config.test.ts` type-checks it with
 * the declaration-emit settings (no `vscode` types in scope), and the repo
 * typecheck compiles it too. A public type that stops being exported, or starts
 * needing the editor, fails here rather than in a consumer's build.
 */
import {
  AGENT_SDK_DEFAULTS,
  HEADLESS_EXIT_CODES,
  createAgent,
  runAgent,
} from '../../src/sdk/index';

import type {
  Agent,
  AgentConfig,
  AgentEvent,
  AgentResult,
  AgentRunCallOptions,
  AgentToolkit,
  HeadlessExitCode,
  HeadlessOutcome,
  HeadlessStreamEvent,
  RuntimeTransportPort,
} from '../../src/sdk/index';

const config: AgentConfig = { auth: { token: 'token' }, workspaceRoot: '/workspace' };
const agent: Agent = createAgent(config);
const options: AgentRunCallOptions = {
  onEvent: (event: AgentEvent) => event.type,
  maxTurns: 1,
};
const pending: Promise<AgentResult> = agent.run('hello', options);
const outcome: Promise<HeadlessOutcome> = pending.then((result) => result.outcome);
const exitCode: Promise<HeadlessExitCode> = pending.then((result) => result.exitCode);
const direct: typeof runAgent = runAgent;
const transportShape: keyof RuntimeTransportPort = 'events';
const toolkitShape: keyof AgentToolkit = 'execute';
const streamEvent: HeadlessStreamEvent['type'] = 'run.started';

export const sdkPublicApiSmoke = [
  outcome,
  exitCode,
  direct,
  transportShape,
  toolkitShape,
  streamEvent,
  AGENT_SDK_DEFAULTS,
  HEADLESS_EXIT_CODES,
] as const;
