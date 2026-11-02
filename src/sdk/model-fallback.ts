import { RuntimeHttpError } from '../headless/runtime-http-error';
import { RuntimeLimitReachedError } from '../headless/runtime-limit-reached-error';
import { RuntimeRateLimitedError } from '../headless/runtime-rate-limited-error';

import {
  AGENT_SDK_DEFAULTS,
  CREDIT_FAILURE_CODE_PATTERN,
  PROVIDER_UNAVAILABLE_CODE_PATTERN,
  RATE_LIMIT_FAILURE_PATTERN,
} from './agent-sdk.constants';
import { failurePayloadCode, runtimeFailureReason } from './runtime-failure';

import type { AgentModelChoice } from './agent-sdk.types';
import type { HeadlessStreamEvent } from '../headless/headless-session.types';

/** A provider and model with nothing left to default. */
export interface ResolvedModel {
  readonly provider: string;
  readonly model: string;
}

/** The model a start was made on, named `provider/model`. */
export function modelLabel(choice: ResolvedModel): string {
  return `${choice.provider}/${choice.model}`;
}

/** The model a run asks for, with the SDK defaults filled in. */
export function primaryModel(options: {
  provider?: string | undefined;
  model?: string | undefined;
}): ResolvedModel {
  return {
    provider: options.provider ?? AGENT_SDK_DEFAULTS.provider,
    model: options.model ?? AGENT_SDK_DEFAULTS.model,
  };
}

/** The configured fallbacks with the primary's provider filled in; the primary and repeats are dropped, so each model is tried once. */
export function resolvedFallbacks(
  primary: ResolvedModel,
  fallbacks: readonly AgentModelChoice[] | undefined,
): ResolvedModel[] {
  const seen = [primary];
  for (const entry of fallbacks ?? []) {
    const choice = { provider: entry.provider ?? primary.provider, model: entry.model };
    if (!seen.some((known) => known.provider === choice.provider && known.model === choice.model)) {
      seen.push(choice);
    }
  }
  return seen.slice(1);
}

/** The fallbacks still unused once a run is on `used`: those listed after it. */
export function fallbacksAfter(
  used: ResolvedModel,
  pending: readonly ResolvedModel[],
): ResolvedModel[] {
  const index = pending.findIndex(
    (entry) => entry.provider === used.provider && entry.model === used.model,
  );
  return index < 0 ? [...pending] : pending.slice(index + 1);
}

/** A refusal whose platform `code` says credit is spent, the provider is busy, or the model is gone. */
function isCreditCode(code: string | undefined): boolean {
  return (
    code !== undefined &&
    (CREDIT_FAILURE_CODE_PATTERN.test(code) || PROVIDER_UNAVAILABLE_CODE_PATTERN.test(code))
  );
}

/**
 * A 429 that outlasted the bounded retries, one the retry budget cut short, or a
 * refusal carrying a credit-gate code: another model can still answer.
 */
export function isRateLimitFailure(error: unknown): boolean {
  return (
    error instanceof RuntimeRateLimitedError ||
    (error instanceof RuntimeLimitReachedError && error.kind === 'credit') ||
    (error instanceof RuntimeHttpError && (error.status === 429 || isCreditCode(error.code)))
  );
}

/** A `run.failed` whose reason says the model was rate limited, or whose code is a credit refusal. */
export function isRateLimitedTerminal(event: HeadlessStreamEvent): boolean {
  return (
    event.type === 'run.failed' &&
    (RATE_LIMIT_FAILURE_PATTERN.test(runtimeFailureReason(event)) ||
      isCreditCode(failurePayloadCode(event.payload)))
  );
}

/**
 * Starts a run on `primary`, and on each fallback in turn while the model stays
 * rate limited.
 *
 * Only a refused START moves on here: nothing has run yet, so another model loses
 * nothing. (A model limited in the middle of a run is `runAgent`'s job: it
 * starts a continuation on the same thread.) Each candidate is tried once, so
 * the walk is bounded by the length of the list; the last candidate's failure is
 * the one thrown, and it already says which model to change. Any other error is
 * final at once.
 */
export async function startWithModelFallback<T>(
  primary: ResolvedModel,
  fallbacks: readonly AgentModelChoice[] | undefined,
  start: (choice: ResolvedModel) => Promise<T>,
  onFallback?: (info: { from: string; to: string }) => void,
): Promise<T> {
  const candidates = [primary, ...resolvedFallbacks(primary, fallbacks)];
  let failure: unknown;
  for (const [index, candidate] of candidates.entries()) {
    const previous = candidates[index - 1];
    if (previous !== undefined) {
      onFallback?.({ from: modelLabel(previous), to: modelLabel(candidate) });
    }
    try {
      return await start(candidate);
    } catch (error) {
      if (!isRateLimitFailure(error)) throw error;
      failure = error;
    }
  }
  throw failure;
}
