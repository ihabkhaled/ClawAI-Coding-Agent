/** The session that started the run. Always addressable, never registered. */
export const MAIN_ADDRESS = 'main';

/**
 * A message is a question, a handoff or a warning, not a transcript. One long
 * enough to be a report is one the recipient pays to read on every turn.
 */
export const MAX_MESSAGE_LENGTH = 2_000;

/** What one recipient may have waiting, so a chatty peer cannot bury an inbox. */
export const MAX_UNREAD_PER_RECIPIENT = 50;

/** What one sender may send over the life of the mailbox. */
export const MAX_SENT_PER_SENDER = 40;

/** The total held, which bounds what the host keeps in memory for a workspace. */
export const MAX_MAILBOX_MESSAGES = 300;
