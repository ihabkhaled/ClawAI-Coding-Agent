/** Address prefix for another VS Code window's main session. */
export const WINDOW_ADDRESS_PREFIX = 'window:';

/** How often a live window rewrites its heartbeat file. */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/** A heartbeat older than this means the window is gone (crashed windows never clean up). */
export const PEER_STALE_MS = 30_000;

/** A message nobody read in this long is dropped: the recipient is not coming back for it. */
export const MESSAGE_TTL_MS = 10 * 60_000;

export const MAX_WINDOW_MESSAGE_LENGTH = 2_000;
export const MAX_WINDOW_INBOX_MESSAGES = 50;
export const MAX_WINDOW_INBOX_BYTES = 128 * 1024;
export const MAX_WINDOW_SENDS = 40;
export const MAX_WINDOW_PEERS = 20;

/** Bounded retry for a rename that Windows refuses while another process holds the file. */
export const RENAME_MAX_ATTEMPTS = 4;
export const RENAME_BACKOFF_MS = 15;

export const MAILBOX_INBOX_DIR = 'inbox';
export const MAILBOX_PEERS_DIR = 'peers';
export const MAILBOX_TEMP_PREFIX = '.tmp-';
export const MAILBOX_FILE_SUFFIX = '.json';
export const MAX_SEEN_IDS = 500;
