import { parseFallbackModels } from '../core/fallback-model-list';
import {
  FALLBACK_CONTINUATION_PROMPT,
  RATE_LIMIT_FAILURE_PATTERN,
} from '../sdk/agent-sdk.constants';

import type { RuntimeStudioInput } from './runtime-studio.types';
import type { RuntimeEvent } from '../core/runtime/runtime-protocol.schemas';

/** The part of the execution dependencies the fallback reads and replaces. */
interface FallbackDependencies {
  readonly input: RuntimeStudioInput;
  readonly configuration: () => { readonly fallbackModels?: readonly string[] | undefined };
}

interface StudioModel {
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
}

/** The model a run is on, named `provider/model`; `AUTO` when the router chose. */
export function studioModelLabel(choice: StudioModel): string {
  return `${choice.provider ?? 'AUTO'}/${choice.model ?? 'AUTO'}`;
}

/** A backend refusal that is a 429, as the extension's own client reports it. */
export function isStudioRateLimit(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'BackendRequestError' &&
    (error as { status?: unknown }).status === 429
  );
}

/** A `run.failed` whose reason says the model was rate limited. */
export function isRateLimitedFailure(event: RuntimeEvent): boolean {
  return (
    event.type === 'run.failed' && RATE_LIMIT_FAILURE_PATTERN.test(JSON.stringify(event.payload))
  );
}

/** The primary model then each configured fallback, each once, with the primary's provider as the default. */
export function studioModelChain(
  primary: StudioModel,
  configured: readonly string[] | undefined,
): StudioModel[] {
  const chain: StudioModel[] = [primary];
  const seen = new Set([studioModelLabel(primary)]);
  for (const entry of parseFallbackModels(configured)) {
    const choice = { provider: entry.provider ?? primary.provider, model: entry.model };
    const label = studioModelLabel(choice);
    if (seen.has(label)) continue;
    seen.add(label);
    chain.push(choice);
  }
  return chain;
}

/** The dependencies for the `index`th model of the chain. */
function dependenciesFor<D extends FallbackDependencies>(
  dependencies: D,
  choice: StudioModel,
  index: number,
  onRateLimited: (() => void) | undefined,
): D {
  const { input } = dependencies;
  return {
    ...dependencies,
    input: {
      ...input,
      ...(choice.provider === undefined ? {} : { provider: choice.provider }),
      ...(choice.model === undefined ? {} : { model: choice.model }),
      ...(index === 0
        ? {}
        : {
            // A fallback is a different request: it must not collapse onto the
            // refused one through the idempotency key.
            requestId: `${input.requestId}.fallback${String(index)}`,
            prompt: `${FALLBACK_CONTINUATION_PROMPT}${input.prompt}`,
          }),
      onEvent: (event) => {
        // The rate-limited ending is not shown while a fallback can take over.
        if (onRateLimited !== undefined && isRateLimitedFailure(event)) {
          onRateLimited();
          return;
        }
        input.onEvent(event);
      },
    },
  };
}

/**
 * Runs one request, moving to the next `clawAI.fallbackModels` entry when the
 * model stays rate limited, at the start or in the middle of the run.
 *
 * The continuation is a new run on the same thread, told to check the workspace
 * and carry on, so nothing already done is repeated blindly. Each model is used
 * once, and the walk stops at once on a cancel. With no fallback configured this
 * is a plain call: the run ends with the original error, as it always did.
 * `attempt` is the whole single-model execution.
 */
export async function executeWithModelFallback<D extends FallbackDependencies>(
  dependencies: D,
  attempt: (dependencies: D) => Promise<void>,
): Promise<void> {
  const { input } = dependencies;
  const chain = studioModelChain(input, dependencies.configuration().fallbackModels);
  for (const [index, choice] of chain.entries()) {
    const last = index === chain.length - 1;
    let limited = false;
    const previous = chain[index - 1];
    if (previous !== undefined) {
      input.onModelFallback?.({ from: studioModelLabel(previous), to: studioModelLabel(choice) });
    }
    try {
      await attempt(
        dependenciesFor(
          dependencies,
          choice,
          index,
          last
            ? undefined
            : () => {
                limited = true;
              },
        ),
      );
    } catch (error) {
      if (last || input.signal.aborted || !isStudioRateLimit(error)) throw error;
      limited = true;
    }
    if (!limited || input.signal.aborted) return;
  }
}
