import { randomUUID } from 'node:crypto';

import { runHeadlessSession } from '../headless/headless-session';
import { HeadlessTransport, sha256 } from '../headless/headless-transport';

import { AGENT_SDK_DEFAULTS } from './agent-sdk.constants';
import { toolResultFor } from './agent-tool-result';

import type { AgentRunOptions, AgentRunResult, RuntimeTransportPort } from './agent-sdk.types';

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
    options.transport ?? new HeadlessTransport(options.backendUrl ?? AGENT_SDK_DEFAULTS.backendUrl);
  const deadlineMs = options.deadlineMs ?? AGENT_SDK_DEFAULTS.deadlineMs;
  const token = await transport.signIn(options.credentials);
  const threadId = await transport.createThread(token, options.title ?? AGENT_SDK_DEFAULTS.title);
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
    budget: { ...AGENT_SDK_DEFAULTS.budget, maxRuntimeMs: deadlineMs },
  });

  const run = { ...started, threadId };
  const report = await runHeadlessSession({
    events: () => transport.events(token, run),
    answerTool: async (event) => {
      await transport.submitResult(token, run, epochs, toolResultFor(event, options.toolkit));
    },
    now: options.now ?? ((): number => Date.now()),
    deadlineMs,
  });

  return { ...report, runId: run.runId };
}
