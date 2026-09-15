import type { ViewDensity } from './view-density.types';

/** The two ways the chat view can be shown. */
export const VIEW_DENSITIES: readonly ViewDensity[] = ['full', 'focus'];

/**
 * What focus mode hides.
 *
 * Everything here reports on work or steers it; none of it is the work. The
 * conversation and the composer stay: a reading mode that hid the conversation
 * would be a blank screen, and one that hid the composer would be a transcript
 * you cannot answer.
 *
 * The workspace bar stays too, even though it is chrome. The toggle back out
 * of focus has to be somewhere the user can still reach, and a mode you cannot
 * leave is not a mode.
 */
export const FOCUS_HIDDEN_SECTIONS: readonly string[] = ['runtimeTimeline', 'modelTray', 'runDeck'];

/** Reads a stored or user-supplied density, defaulting to the full view. */
export function normalizeViewDensity(value: unknown): ViewDensity {
  return value === 'focus' ? 'focus' : 'full';
}

/**
 * The density after toggling.
 *
 * A toggle rather than two commands because the two states are one question —
 * "am I reading or working" — and a person who has just hidden the chrome
 * knows exactly how to get it back.
 */
export function toggleViewDensity(current: ViewDensity): ViewDensity {
  return current === 'focus' ? 'full' : 'focus';
}
