/** GitHub's own comment limit is 65,536 characters; this stays well inside it. */
export const MAX_REVIEW_COMMENT_LENGTH = 10_000;
export const GITHUB_HOSTS: readonly string[] = ['github.com', 'www.github.com'];
export const GITLAB_DEFAULT_HOST = 'gitlab.com';
/** The separator every GitLab merge-request URL carries after the project path. */
export const GITLAB_MERGE_REQUEST_MARKER = '/-/merge_requests/';
