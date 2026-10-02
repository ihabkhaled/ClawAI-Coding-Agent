export const REPOSITORY_NAME_MAX = 200;
export const REPOSITORY_BRANCH_MAX = 200;
export const REPOSITORY_REMOTE_MAX = 500;

/** A folder or repository name, not a path: no separators, no control characters. */
export const REPOSITORY_NAME_PATTERN = /^[^/\\\p{Cc}]+$/u;

/** A git ref name, narrowed: no whitespace, control characters or `~ ^ : ? * [ \`. */
export const REPOSITORY_BRANCH_PATTERN = /^[^\s\p{Cc}~^:?*[\\]+$/u;

export const REMOTE_URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//iu;
export const REMOTE_SCP_HOST_PATTERN = /^[a-z0-9][a-z0-9.-]*$/iu;
export const REMOTE_SCP_PATH_PATTERN = /^[\w.~+@%/-]+$/u;
export const REMOTE_FORBIDDEN_PATTERN = /[\s\p{Cc}]|(?:^|[/:])\.\.(?:[/?#]|$)/u;
export const REMOTE_ALLOWED_PROTOCOLS: readonly string[] = ['http:', 'https:', 'ssh:', 'git:'];
