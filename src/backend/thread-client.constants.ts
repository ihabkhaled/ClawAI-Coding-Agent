/**
 * The origin every thread this extension creates is tagged with.
 *
 * The coding agent talks to the same chat API as the web app and as the same
 * user. Without this tag each run appeared in the user's chat list beside
 * conversations they had themselves, and the web app had no way to tell the
 * two apart. The backend defaults an omitted origin to WEB, so leaving it off
 * is what the old behaviour was.
 */
export const THREAD_ORIGIN = 'CODING_AGENT';
