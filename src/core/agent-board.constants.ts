/**
 * How much one agent may put on the shared board.
 *
 * A per-agent quota, not just a total. A single total is the failure this is
 * built to avoid: one chatty explorer posting two hundred notes would push
 * every other agent's work off the board, and the agents that lost their notes
 * would have no way to tell that happened. Twenty each is enough to record what
 * you found and too few to monopolise.
 */
export const MAX_NOTES_PER_AGENT = 20;

/** The board's total, which bounds what any reader has to take into context. */
export const MAX_BOARD_NOTES = 200;

/**
 * One note is a finding, a claim or a warning, not a transcript. A note long
 * enough to be a report is one every other agent pays to read.
 */
export const MAX_NOTE_LENGTH = 2_000;
