/** How much of a remote command's stdout/stderr the model is shown: the tail, where failures are. */
export const REMOTE_OUTPUT_TAIL_CHARACTERS = 4_000;

/** Backend statuses a remote-job call answers as a refusal the model can act on. */
export const REMOTE_REFUSAL_STATUSES: readonly number[] = [400, 404, 409];

export const MAX_REMOTE_INTERVAL_MINUTES = 60 * 24 * 7;
