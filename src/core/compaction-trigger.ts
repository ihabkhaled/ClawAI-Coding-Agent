import type {
  AutoCompactionAction,
  AutoCompactionInput,
  AutoCompactionMode,
} from './compaction-trigger.types';

/**
 * Whether to act on a nearly-full conversation, and how.
 *
 * `shouldCompact` has been able to answer "this conversation is nearly full"
 * since 1.12.0 and nothing ever asked it. The reason a trigger is a separate
 * decision from the measurement is that three things make acting wrong even
 * when the measurement is right.
 *
 * A run still in flight is the first. Compaction continues the conversation in
 * a NEW thread, so starting one while a run is writing into the old thread
 * splits the record in half: part of the answer lands where nobody will look
 * again.
 *
 * Having already raised it is the second. A conversation stays nearly full
 * until something is done about it, and a state subscription fires on every
 * change, so asking on each one would ask dozens of times about the same
 * conversation. The flag is cleared when usage falls back — after a compaction,
 * or when the conversation moves on — so a later fill asks again.
 *
 * The user's setting is the third, and it comes last on purpose: `off` has to
 * beat every other reason to act, including a conversation that is genuinely
 * about to overflow.
 */
export function decideAutoCompaction(input: AutoCompactionInput): AutoCompactionAction {
  if (input.mode === 'off') return 'none';
  if (!input.nearlyFull) return 'none';
  if (input.runInFlight) return 'none';
  if (input.alreadyRaised) return 'none';
  return input.mode === 'automatic' ? 'compact' : 'offer';
}

/**
 * The conversations that have been raised, after this measurement.
 *
 * Tracked per conversation rather than as a single flag: two open panels are
 * two conversations, and one of them filling up says nothing about the other.
 * Falling back below the threshold forgets the conversation, which is what
 * makes a second offer possible without making it constant.
 */
export function trackRaisedConversations(
  raised: ReadonlySet<string>,
  threadId: string,
  nearlyFull: boolean,
): Set<string> {
  const next = new Set(raised);
  if (nearlyFull) {
    next.add(threadId);
  } else {
    next.delete(threadId);
  }
  return next;
}

const MODES: readonly AutoCompactionMode[] = ['off', 'prompt', 'automatic'];

/**
 * A settings file is user-editable, so an unrecognised value resolves to the
 * default rather than throwing. `prompt` is the default because it is the only
 * one that cannot surprise anybody: nothing happens without an answer.
 */
export function normalizeAutoCompactionMode(value: unknown): AutoCompactionMode {
  return MODES.find((mode) => mode === value) ?? 'prompt';
}
