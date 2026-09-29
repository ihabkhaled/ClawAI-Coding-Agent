/**
 * How long after the last prompt a thread with no reply is still treated as
 * possibly running elsewhere. Past this a missing reply is a failed run, not a
 * live one, and warning about it would only train people to ignore the prompt.
 */
export const ACTIVE_ELSEWHERE_WINDOW_MS = 10 * 60 * 1_000;
