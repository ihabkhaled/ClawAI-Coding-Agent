import { randomUUID } from 'node:crypto';

import { runHeadlessSession } from '../headless/headless-session';
import { HeadlessTransport, sha256 } from '../headless/headless-transport';

import { runWithFallbacks } from './agent-run-fallback';
import { AGENT_SDK_DEFAULTS } from './agent-sdk.constants';
import { toolCallOf, toolResultFor } from './agent-tool-result';
import { profileDeadlineMs, resolveRunBudget } from './budget-profiles';
import { deferralFor, startRunWithDeferral } from './deferred-run';
import { deferredToolkit } from './deferred-toolkit';
import {
  fallbacksAfter,
  isRateLimitedTerminal,
  primaryModel,
  startWithModelFallback,
} from './model-fallback';
import { reportUndeliveredImages, uploadPromptImages } from './prompt-images';
import { openThread } from './thread-memory';
import { describeTools } from './tool-alias';

import type { AttemptInput, AttemptOutcome } from './agent-run-fallback';
import type {
  AgentRunOptions,
  AgentRunResult,
  AgentToolkit,
  RuntimeTransportPort,
} from './agent-sdk.types';
import type { DeferredLoaderRef } from './deferred-toolkit';
import type { ResolvedModel } from './model-fallback';
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

  const attached = await uploadPromptImages(transport, token, options.images);
  const requestId = `request.${randomUUID()}`;
  const startWith = (
    choice: ResolvedModel,
    idempotencyKey: string,
    prompt: string,
    definitions: readonly unknown[],
  ): Promise<{ runId: string; generation: string }> =>
    transport.startRun(token, {
      schemaVersion: '2.0',
      threadId,
      clientRequestId: requestId,
      idempotencyKey,
      prompt,
      ...attached,
      // The catalog and manifest hash a plain serialization, matching the
      // extension. Only the tool-result receipt uses the canonical form, and
      // swapping the two is a server error with no detail attached.
      manifestHash: sha256(JSON.stringify({ targets: ['target:workspace'] })),
      toolCatalogHash: sha256(JSON.stringify(definitions)),
      toolDefinitions: definitions,
      provider: choice.provider,
      model: choice.model,
      epochs,
      budget: resolveRunBudget(options.budgetProfile, deadlineMs, options.budget),
    });
  const catalog = deferralFor(options.toolkit.definitions, options.deferTools, transport);
  const now = options.now ?? ((): number => Date.now());

  const attempt = async (input: AttemptInput): Promise<AttemptOutcome> => {
    const { progress } = input;
    progress.rest = [];
    let used = input.target;
    // A model that was rate limited at the start hands over to the next one
    // here; one that is limited mid-run is handed over by `runWithFallbacks`.
    const { started, deferred } = await startWithModelFallback(
      input.target,
      input.candidates,
      (choice) => {
        used = choice;
        // A refused start stores nothing, so one key serves a model's own
        // retries; a fallback model is a different request and gets its own.
        const idempotencyKey = `idem.${randomUUID()}`;
        return startRunWithDeferral(
          (definitions) => startWith(choice, idempotencyKey, input.prompt, definitions),
          catalog,
          options.toolkit.definitions,
        );
      },
      options.onModelFallback,
    );
    progress.used = used;
    progress.rest = fallbacksAfter(used, input.candidates);
    const loader: DeferredLoaderRef = { current: undefined };
    const toolkit =
      deferred && catalog !== undefined
        ? deferredToolkit(options.toolkit, catalog, loader)
        : options.toolkit;

    const run = { ...started, threadId };
    loader.current = (definitions, signal) =>
      transport.loadTools?.(token, run, definitions, signal) ??
      Promise.reject(new Error('This transport cannot load deferred tools.'));
    await reportUndeliveredImages(
      transport,
      token,
      run,
      attached.fileIds,
      options.onImagesNotDelivered,
    );
    options.onStarted?.({
      runId: run.runId,
      threadId,
      ...(memory === undefined ? {} : { memory }),
    });
    let swallowed = false;
    const report = await runHeadlessSession({
      events: () => transport.events(token, run, options.signal),
      answerTool: async (event) => {
        const denial = await deniedReason(event, toolkit);
        await transport.submitResult(
          token,
          run,
          epochs,
          await toolResultFor(event, toolkit, denial, options.signal),
        );
      },
      now,
      deadlineMs: input.timeLeftMs(),
      onEvent: (event) => {
        // A rate-limited ending is not reported while a fallback can still take
        // over: the caller would see a failure that the run then recovers from.
        if (
          progress.rest.length > 0 &&
          options.signal?.aborted !== true &&
          isRateLimitedTerminal(event)
        ) {
          swallowed = true;
          return;
        }
        options.onEvent?.(event);
      },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    return { report, runId: run.runId, threadId, swallowed };
  };

  return runWithFallbacks(
    {
      primary: primaryModel(options),
      fallbacks: options.fallbackModels,
      prompt: options.prompt,
      deadlineMs,
      now,
      signal: options.signal,
      onModelFallback: options.onModelFallback,
    },
    attempt,
  );
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
  if (allowed) return undefined;
  const call = toolCallOf(event);
  return isOffered(call.toolName, toolkit)
    ? 'The tool call was not permitted for this run.'
    : `Unknown tool "${call.toolName}". Use exactly one of these tool names and operations:
${describeTools(toolkit.definitions)}`;
}

function isOffered(toolName: string, toolkit: AgentToolkit): boolean {
  return toolkit.definitions.some(
    (definition) => (definition as { name?: unknown }).name === toolName,
  );
}
