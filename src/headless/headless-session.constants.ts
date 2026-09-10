/**
 * The events that end a run.
 *
 * Kept beside the loop that watches for them, because a terminal event this
 * list does not know is a run that never appears to stop.
 */
export const HEADLESS_TERMINAL_EVENTS: readonly string[] = [
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.blocked',
];

/** The redirect the authorization must be told to use; any other path is refused. */
export const HEADLESS_CALLBACK_URI = 'vscode://clawai.clawai-coding-agent/auth/callback';

/** How this runner identifies itself during authorization. */
export const HEADLESS_CLIENT_NAME = 'ClawAI headless runner';

/** The largest file a headless run may write in one call. */
export const HEADLESS_MAX_CONTENT_BYTES = 100_000;
