import { RUNTIME_TERMINAL_EVENT_TYPES } from '../core/runtime/runtime-terminal-events.constants';

/** The events that end a run: the same list the editor's follow loop uses. */
export const HEADLESS_TERMINAL_EVENTS: readonly string[] = RUNTIME_TERMINAL_EVENT_TYPES;

/** The redirect the authorization must be told to use; any other path is refused. */
export const HEADLESS_CALLBACK_URI = 'vscode://clawai.clawai-coding-agent/auth/callback';

/** How this runner identifies itself during authorization. */
export const HEADLESS_CLIENT_NAME = 'ClawAI headless runner';

/** The largest file a headless run may write in one call. */
export const HEADLESS_MAX_CONTENT_BYTES = 100_000;
