/** The prefix that marks a marketplace as a git repository to clone. */
export const GIT_MARKETPLACE_PREFIX = 'git+';

/**
 * A branch or tag name a clone may be asked for. No leading dash, so it can
 * never be read as a git option, and no `..`, which git itself refuses.
 */
export const GIT_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u;

/** Where marketplace clones live, under the extension's global storage. */
export const GIT_MARKETPLACE_DIRECTORY = 'plugin-marketplaces';

/** A shallow clone of a catalog repository has no business taking longer. */
export const GIT_CLONE_TIMEOUT_MS = 120_000;

/** git's own progress chatter; the output is only kept to explain a failure. */
export const GIT_CLONE_OUTPUT_BYTES = 65_536;
