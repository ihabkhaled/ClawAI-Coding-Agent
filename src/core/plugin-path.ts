/**
 * Whether a path from someone else's content stays inside the folder it names.
 *
 * Forward slashes only, no drive letter, no leading slash and no `..` segment.
 * A backslash is refused rather than translated, because a path that means one
 * thing on Windows and another elsewhere is the shape a zip-slip takes.
 */
export function isContainedRelativePath(path: string): boolean {
  if (path.length === 0 || path.includes('\\') || path.includes('\0')) return false;
  // A colon is a drive on Windows and an alternate data stream after a file name.
  if (path.startsWith('/') || path.includes(':')) return false;
  return path.split('/').every((segment) => segment !== '..' && segment !== '');
}

/**
 * The paths with one shared top-level folder removed, when they all have one.
 *
 * GitHub and most archivers wrap a plugin in `name-1.0.0/`, and a manifest one
 * level down is still the plugin's manifest.
 */
export function stripSharedTopFolder(paths: readonly string[]): readonly string[] {
  const first = paths[0]?.split('/')[0];
  if (first === undefined || paths.some((path) => !path.startsWith(`${first}/`))) return paths;
  return paths.map((path) => path.slice(first.length + 1));
}
