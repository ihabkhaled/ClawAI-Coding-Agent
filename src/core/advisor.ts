import { z } from 'zod';

import type { AdviceRecord, AdvisorSelection } from './advisor.types';
import type { ModelCatalogEntry } from './model-catalog';

/**
 * Which model should give the second opinion.
 *
 * It must not be the model already running. Asking the same model the same
 * question in the same conversation is not a second opinion; it is the same
 * opinion, restated with more confidence, and a run that treats it as
 * corroboration is worse off than one that never asked.
 *
 * Preference order is deliberate. A tool-capable model is preferred because it
 * has been trained on the shape of the work being asked about. A remote model
 * is preferred over a local one because a local model is usually the small
 * model, and a smaller second opinion tends to agree rather than to check. A
 * bigger context window breaks the remaining ties, since advice is only as good
 * as how much of the question fits.
 */
export function pickAdvisor(
  catalog: readonly ModelCatalogEntry[],
  runningModelKey: string,
): AdvisorSelection | undefined {
  const candidates = catalog.filter((entry) => entry.key !== runningModelKey);
  const ranked = [...candidates].sort((left, right) => {
    if (left.supportsTools !== right.supportsTools) return left.supportsTools ? -1 : 1;
    if (left.isLocal !== right.isLocal) return left.isLocal ? 1 : -1;
    return (right.contextTokens ?? 0) - (left.contextTokens ?? 0);
  });
  const chosen = ranked[0];
  return chosen === undefined
    ? undefined
    : {
        key: chosen.key,
        provider: chosen.provider,
        model: chosen.model,
        displayName: chosen.displayName,
      };
}

/**
 * How the question reaches the advisor.
 *
 * The advisor is told it is advising, not deciding, and is told not to act.
 * Without that, a capable model handed a question about a repository starts
 * proposing edits, and the run that asked has to work out which half of the
 * reply was an answer and which half was an instruction it never authorised.
 *
 * The context is passed as the asker's summary rather than as the conversation.
 * A second opinion built from the first model's framing is worth less than one
 * built from the facts, but handing over a whole conversation sends far more
 * than the question needs to a model the user did not pick for the run.
 */
export function buildAdvicePrompt(question: string, context: string): string {
  return [
    'You are being consulted for a second opinion. You are advising, not deciding.',
    'Answer the question directly. Do not propose or perform any action, and do not',
    'ask for more work — the agent that consulted you decides what happens next.',
    context.trim().length === 0 ? '' : `Context:\n${context.trim()}`,
    `Question:\n${question.trim()}`,
  ]
    .filter((part) => part.length > 0)
    .join('\n\n');
}

/**
 * Advice, labelled as advice.
 *
 * `binding: false` is carried in the record rather than left to a reader's
 * inference, and the advisor is named. A second opinion whose source is not
 * recorded cannot be weighed later, and one that reads like a verdict gets
 * followed for the wrong reason.
 */
export function recordAdvice(
  advisor: AdvisorSelection,
  question: string,
  advice: string,
): AdviceRecord {
  return { advisor: advisor.displayName, question, advice, binding: false };
}

/**
 * What a consultation may carry.
 *
 * Both fields are bounded because the advisor is a model the user did not pick
 * for this run: the less that reaches it, the smaller the surprise. The context
 * is optional and defaults to empty, so a self-contained question needs no
 * ceremony.
 */
export const advisorInputSchema = z.object({
  question: z.string().trim().min(1).max(4_000),
  context: z.string().max(8_000).default(''),
});
