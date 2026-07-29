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
