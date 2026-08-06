const windowsAbsolutePattern = /^[A-Za-z]:[\\/]/u;
const windowsDeviceNamePattern = /^(?:aux|com[1-9]|con|lpt[1-9]|nul|prn)(?:\..*)?$/iu;
const sensitiveNamePattern =
  /(?:secret|credential|api[-_]?key|password|passwd|private[-_]?key|(?:^|[._-])token(?:[._-]|$)|(?:access|refresh|auth)[-_]?token)/iu;
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
        sensitiveNamePattern.test(normalized)
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
