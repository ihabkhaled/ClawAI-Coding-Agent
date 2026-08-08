const windowsAbsolutePattern = /^[A-Za-z]:[\\/]/u;
const windowsDeviceNamePattern = /^(?:aux|com[1-9]|con|lpt[1-9]|nul|prn)(?:\..*)?$/iu;
const sensitiveNamePattern =
  /(?:secret|credential|api[-_]?key|private[-_]?key|(?:access|refresh|auth)[-_]?token)/iu;

/**
 * Password and token names get word-boundary AND shape care.
 *
 * The bare substring rule denied every path CONTAINING "password" — which is
 * every file a password-reset feature consists of. Screened live: a model
 * asked to read `docs/…/password-reset-task.md` produced the correct path 38
 * times, was refused every time with an unactionable schema error, and ran out
 * of budget. The bare `token` word rule had the same overreach one directory
 * later: a Prisma migration named `…_add_password_reset_token` is a folder of
 * feature code, not a credential store.
 *
 * What stays denied is what the rule exists for — names that plausibly STORE
 * credentials: a standalone password/token name outside a code module
 * (`passwords.txt`, `password.md`, `token.txt`, a `passwords/` directory,
 * `etc/passwd`) and any compound with a data-shaped extension
 * (`user-passwords.csv`, `password-dump.json`, `password-recovery-codes.txt`).
 * What passes is code and documents that merely implement or describe the
 * feature (`password-reset.controller.ts`, `reset-password/page.tsx`,
 * `password-reset-flow.md`, a `…_add_password_reset_token/` migration
 * directory). `access/refresh/auth`-token compounds stay under the strict
 * substring rule above — those name the credential itself.
 */
const credentialWordPattern = /(?:^|[^a-z0-9])(?:passwords?|passwd|tokens?)(?:[^a-z0-9]|$)/u;
const credentialWordOnly = /^(?:passwords?|passwd|tokens?)$/u;
const codeExtensionPattern =
  /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|cs|php|swift|scala|vue|svelte|astro|sql|prisma|graphql|gql|proto|css|scss|less)$/u;
const documentExtensionPattern = /\.(?:md|mdx|html|adoc|rst|tex)$/u;

function isCredentialShapedSegment(segment: string): boolean {
  if (!credentialWordPattern.test(segment)) return false;
  const extension = /\.[a-z0-9]+$/u.exec(segment);
  const stem = extension === null ? segment : segment.slice(0, extension.index);
  const words = stem.split(/[^a-z0-9]+/u).filter((word) => word.length > 0);
  if (words.every((word) => credentialWordOnly.test(word))) {
    // "password", "passwords.txt", "token.txt" — a code module is the one
    // standalone spelling that is clearly an implementation, not a store.
    return extension === null || !codeExtensionPattern.test(segment);
  }
  // Compound names are feature code or prose unless the file is data-shaped.
  if (extension === null) return false;
  return !codeExtensionPattern.test(segment) && !documentExtensionPattern.test(segment);
}
const sensitiveExactNames = new Set([
  '.git',
  '.ssh',
  '.npmrc',
  '.pypirc',
  '.netrc',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
]);

export function normalizeWorkspacePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\/+/u, '');
}

export function isSensitiveWorkspacePath(path: string): boolean {
  return normalizeWorkspacePath(path)
    .split('/')
    .some((segment) => {
      const normalized = segment.replace(/[. ]+$/gu, '').toLowerCase();
      return (
        sensitiveExactNames.has(normalized) ||
        normalized === '.env' ||
        normalized.startsWith('.env.') ||
        sensitiveNamePattern.test(normalized) ||
        isCredentialShapedSegment(normalized)
      );
    });
}

// The canonical way to name a workspace root: the empty relative path. Joining
// it onto a root yields the root itself.
export const WORKSPACE_ROOT_PATH = '';

// What a model naturally writes when it means "the workspace root".
const rootAliases = new Set(['', '.', './', '/', '\\']);

/**
 * Normalizes the ways a caller can name a directory, including the root.
 *
 * `isSafeRelativeWorkspacePath` rejects every spelling of the root — `''` is
 * empty, `'.'` trips the trailing-dot rule, `'./'` normalizes to empty and `'/'`
 * is absolute — so there was no value that meant "the workspace root". A model
 * asked to gain context on a workspace has to list the root first and cannot
 * name a subdirectory it has not discovered yet, which made the very first tool
 * call of any exploratory task impossible. Root aliases collapse to
 * `WORKSPACE_ROOT_PATH`; everything else keeps the existing relative-path rules.
 */
export function normalizeWorkspaceDirectoryPath(path: string): string {
  const trimmed = path.trim();
  if (rootAliases.has(trimmed)) return WORKSPACE_ROOT_PATH;
  return normalizeWorkspacePath(trimmed);
}

/**
 * Directory-shaped counterpart to `isSafeRelativeWorkspacePath`.
 *
 * The root is addressable here and nowhere else: this is only for operations
 * that enumerate a directory. Reads and mutations keep the stricter rule, since
 * "write to the root" is never a meaningful request.
 */
export function isSafeWorkspaceDirectoryPath(path: string): boolean {
  const normalized = normalizeWorkspaceDirectoryPath(path);
  return normalized === WORKSPACE_ROOT_PATH || isSafeRelativeWorkspacePath(normalized);
}

export function isSafeRelativeWorkspacePath(path: string): boolean {
  const normalized = normalizeWorkspacePath(path);
  const segments = normalized.split('/');
  return (
    normalized.length > 0 &&
    !normalized.startsWith('/') &&
    !windowsAbsolutePattern.test(path) &&
    !segments.includes('..') &&
    segments.every(
      (segment) =>
        !segment.includes(':') &&
        !/[. ]$/u.test(segment) &&
        !windowsDeviceNamePattern.test(segment),
    ) &&
    !isSensitiveWorkspacePath(normalized)
  );
}
