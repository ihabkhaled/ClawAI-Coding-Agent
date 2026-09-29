import type { CloudWatchPolicy } from './remote-session-commands.types';

/** Web threads offered for resume. Matches the sidebar's default history size. */
export const RESUME_WEB_THREAD_LIMIT = 50;

/** Messages read to decide whether a resumed thread's last run is still live. */
export const RESUME_PROBE_MESSAGES = 5;

/** Three seconds for up to twenty minutes; the runner's own timeout is five. */
export const CLOUD_WATCH_POLICY: CloudWatchPolicy = { intervalMs: 3_000, maxPolls: 400 };

/** Output kept per stream when a session finishes. */
export const CLOUD_OUTPUT_TAIL_CHARACTERS = 8_000;
