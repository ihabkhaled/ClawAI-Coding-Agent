import { randomUUID } from 'node:crypto';

import { runHeadlessSession } from '../headless/headless-session';
import { HeadlessTransport, sha256 } from '../headless/headless-transport';

import { AGENT_SDK_DEFAULTS } from './agent-sdk.constants';
import { toolCallOf, toolResultFor } from './agent-tool-result';
import { profileDeadlineMs, resolveRunBudget } from './budget-profiles';
import { openThread } from './thread-memory';

import type {
  AgentRunOptions,
  AgentRunResult,
  AgentToolkit,
  RuntimeTransportPort,
} from './agent-sdk.types';
import type { HeadlessStreamEvent } from '../headless/headless-session.types';

/**
 * Runs one agent task against the runtime, with no editor and no host.
 *
 * This is the library the extension and the headless runner are both built on,
 * exposed so a third caller does not have to reimplement the parts that are
 * easy to get subtly wrong: the authorization that looks like it needs a
 * browser and does not, the two different hash forms the backend verifies, and
 * the receipt shape it rejects without explaining.
 *
 * The caller supplies the tools. That is the whole point of the boundary —
 * fixing a tool set here would serve only the application this was extracted
 * from, and the next application's tools are always different.
 *
 * Everything reachable from outside is injectable, so a caller can test their
 * toolkit against a fake transport without a backend, a model, or a bill.
 */
export async function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  const transport: RuntimeTransportPort =
    options.transport ??
    new HeadlessTransport(options.backendUrl ?? AGENT_SDK_DEFAULTS.backendUrl, {
      signal: options.signal,
    });
  const deadlineMs = options.deadlineMs ?? profileDeadlineMs(options.budgetProfile);
  const token = await accessToken(transport, options);
  const { threadId, memory } = await openThread(transport, token, options);
  const epochs = { account: 1, workspace: 1, target: 1, policy: 1 };

  const started = await transport.startRun(token, {
    schemaVersion: '2.0',
    threadId,
    clientRequestId: `request.${randomUUID()}`,
    idempotencyKey: `idem.${randomUUID()}`,
    prompt: options.prompt,
    // The catalog and manifest hash a plain serialization, matching the
    // extension. Only the tool-result receipt uses the canonical form, and
    // swapping the two is a server error with no detail attached.
    manifestHash: sha256(JSON.stringify({ targets: ['target:workspace'] })),
    toolCatalogHash: sha256(JSON.stringify(options.toolkit.definitions)),
    toolDefinitions: options.toolkit.definitions,
    provider: options.provider ?? AGENT_SDK_DEFAULTS.provider,
    model: options.model ?? AGENT_SDK_DEFAULTS.model,
    epochs,
    budget: resolveRunBudget(options.budgetProfile, deadlineMs, options.budget),
  });

  const run = { ...started, threadId };
  options.onStarted?.({ runId: run.runId, threadId, ...(memory === undefined ? {} : { memory }) });
  const report = await runHeadlessSession({
    events: () => transport.events(token, run, options.signal),
    answerTool: async (event) => {
      const denial = await deniedReason(event, options.toolkit);
      await transport.submitResult(
        token,
        run,
        epochs,
        await toolResultFor(event, options.toolkit, denial, options.signal),
      );
    },
    now: options.now ?? ((): number => Date.now()),
    deadlineMs,
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  return { ...report, runId: run.runId, threadId };
}

/**
 * A token the caller already holds is used as given; otherwise the credentials
 * are exchanged for one. Neither is a usage error the caller can fix, so it is
 * said plainly rather than surfacing as a sign-in with empty strings.
 */
async function accessToken(
  transport: RuntimeTransportPort,
  options: AgentRunOptions,
): Promise<string> {
  if (options.token !== undefined && options.token.length > 0) return options.token;
  if (options.credentials === undefined) {
    throw new Error('runAgent needs either a token or credentials');
  }
  return transport.signIn(options.credentials);
}

async function deniedReason(
  event: HeadlessStreamEvent,
  toolkit: AgentToolkit,
): Promise<string | undefined> {
  if (toolkit.authorize === undefined) return undefined;
  const allowed = await toolkit.authorize(toolCallOf(event));
  return allowed ? undefined : 'The tool call was not permitted for this run.';
}
