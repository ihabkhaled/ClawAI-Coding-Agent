import { FALLBACK_CONTINUATION_PROMPT } from './agent-sdk.constants';
import {
  fallbacksAfter,
  isRateLimitFailure,
  modelLabel,
  resolvedFallbacks,
} from './model-fallback';

import type { AgentRunOptions, AgentRunResult } from './agent-sdk.types';
import type { ResolvedModel } from './model-fallback';
import type { HeadlessRunReport } from '../headless/headless-session.types';

/** What an attempt shares with the loop, so a thrown error still says which model was on. */
export interface AttemptProgress {
  /** The model the latest attempt actually started on. */
  used: ResolvedModel;
  /** Fallbacks not yet used; empty until an attempt has started. */
  rest: ResolvedModel[];
}

export interface AttemptInput {
  readonly target: ResolvedModel;
  readonly candidates: ResolvedModel[];
  readonly prompt: string;
  readonly timeLeftMs: () => number;
  readonly progress: AttemptProgress;
}

export interface AttemptOutcome {
  readonly report: HeadlessRunReport;
  readonly runId: string;
  readonly threadId: string;
  /** The run ended `run.failed` on a rate limit and was held back, because a fallback can take over. */
  readonly swallowed: boolean;
}

/**
 * Drives a run across the model list: the start, and a model that is rate
 * limited in the middle of the run.
 *
 * An attempt that ends on a 429 (an exhausted `RuntimeRateLimitedError`, or a
 * `run.failed` that says so) is continued on the next model as a new run on the
 * same thread, told to check the workspace and carry on. It continues only while
 * a fallback is left, the caller has not cancelled, and the deadline has time
 * in it; each model is used once, so the walk is bounded by the list. Without a
 * fallback the failure is the caller's, at once: never a wait, never a hang.
 */
export async function runWithFallbacks(
  config: Pick<AgentRunOptions, 'prompt' | 'signal' | 'onModelFallback'> & {
    readonly primary: ResolvedModel;
    readonly fallbacks: AgentRunOptions['fallbackModels'];
    readonly deadlineMs: number;
    readonly now: () => number;
  },
  attempt: (input: AttemptInput) => Promise<AttemptOutcome>,
): Promise<AgentRunResult> {
  const begun = config.now();
  const timeLeftMs = (): number => Math.max(config.deadlineMs - (config.now() - begun), 0);
  const progress: AttemptProgress = {
    used: config.primary,
    rest: resolvedFallbacks(config.primary, config.fallbacks),
  };
  let target = config.primary;
  let candidates = [...progress.rest];
  let prompt = config.prompt;
  let toolCalls = 0;
  for (;;) {
    let outcome: AttemptOutcome | undefined;
    let failure: unknown;
    try {
      outcome = await attempt({ target, candidates, prompt, timeLeftMs, progress });
      toolCalls += outcome.report.toolCalls;
    } catch (error) {
      if (!isRateLimitFailure(error)) throw error;
      failure = error;
    }
    const next =
      config.signal?.aborted === true || timeLeftMs() <= 0 ? undefined : progress.rest[0];
    if (outcome !== undefined && (!outcome.swallowed || next === undefined)) {
      return { ...outcome.report, toolCalls, runId: outcome.runId, threadId: outcome.threadId };
    }
    if (next === undefined) throw failure;
    config.onModelFallback?.({ from: modelLabel(progress.used), to: modelLabel(next) });
    prompt = `${FALLBACK_CONTINUATION_PROMPT}${config.prompt}`;
    target = next;
    candidates = fallbacksAfter(next, progress.rest);
  }
}
