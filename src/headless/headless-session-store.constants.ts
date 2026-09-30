/** Overrides where the CLI keeps its state; otherwise `~/.clawai`. */
export const HEADLESS_STATE_DIR_ENV = 'CLAW_STATE_DIR';

export const HEADLESS_STATE_DIR_NAME = '.clawai';
export const HEADLESS_SESSION_FILE = 'headless-threads.json';

/** Older scopes are dropped past this, so the file cannot grow without bound. */
export const HEADLESS_SESSION_MAX_ENTRIES = 100;
