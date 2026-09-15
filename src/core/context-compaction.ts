import type { ContextBudget } from './context-budget.types';
import type { CompactionDecision } from './context-compaction.types';

/** How full the prompt allowance has to get before compaction is worth offering. */
export const COMPACTION_THRESHOLD = 0.9;

/**
 * The instruction that turns a conversation into something short enough to
 * carry forward.
 *
 * Written to preserve decisions rather than prose. What matters when a
 * conversation is continued is what was decided, what is still open, and which
 * files are in play — not a readable retelling of how the discussion went. A
 * summary optimised for reading loses exactly the parts the next turn needs.
 */
export const COMPACTION_INSTRUCTION = [
  'Summarize this conversation so it can be continued in a new one.',
  'Preserve, in this order: the goal; decisions made and why; work completed;',
  'work still outstanding; open questions; and the files and paths involved.',
  'Omit pleasantries, restatement and narration. Be specific about names and',
  'paths — a name you leave out is a name the next turn cannot use.',
].join(' ');

/**
 * Whether this conversation is close enough to full to be worth compacting.
 *
 * An unknown window never triggers. Compaction throws away the original
 * conversation's detail, and doing that on a guess is worse than letting the
 * server drop the oldest messages, which at least happens for a measured
 * reason.
 */
export function shouldCompact(
  budget: ContextBudget | undefined,
  spentTokens: number,
): CompactionDecision {
  if (budget === undefined) return { compact: false, reason: 'unknown-capacity' };
  if (budget.availableForPrompt <= 0) return { compact: false, reason: 'unknown-capacity' };
  const used = spentTokens / budget.availableForPrompt;
  return used >= COMPACTION_THRESHOLD
    ? { compact: true, reason: 'nearly-full' }
    : { compact: false, reason: 'room-remains' };
}

/**
 * The first message of the continued conversation.
 *
 * The summary is labelled as a summary rather than presented as something the
 * user said. A model handed a digest as if it were a request tends to answer
 * the digest.
 */
export function compactionSeed(summary: string): string {
  return [
    'This conversation continues an earlier one. Here is what happened so far:',
    '',
    summary.trim(),
    '',
    'Continue from here. Ask if anything above is unclear rather than assuming.',
  ].join('\n');
}
