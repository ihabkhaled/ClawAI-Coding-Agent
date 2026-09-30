const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/iu;
const HOSTILE_CHARACTERS = /[<>"|?*]/u;

function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) < 0x20) return true;
  }
  return false;
}

/** A segment Windows would rewrite or refuse: a device name or a trailing dot or space. */
function isWindowsHostileSegment(segment: string): boolean {
  return WINDOWS_DEVICE_NAME.test(segment) || /[. ]$/u.test(segment);
}

/**
 * Whether a path from someone else's content stays inside the folder it names.
 *
 * Forward slashes only, no drive letter, no leading slash and no `..` segment.
 * A backslash is refused rather than translated, because a path that means one
 * thing on Windows and another elsewhere is the shape a zip-slip takes.
 * Names Windows treats specially (`NUL`, `CON.txt`, `plugin.json.`) are refused
 * everywhere, so a plugin unpacks identically on every platform.
 */
export function isContainedRelativePath(path: string): boolean {
  if (
    path.length === 0 ||
    path.includes('\\') ||
    HOSTILE_CHARACTERS.test(path) ||
    hasControlCharacter(path)
  )
    return false;
  // A colon is a drive on Windows and an alternate data stream after a file name.
  if (path.startsWith('/') || path.includes(':')) return false;
  return path
    .split('/')
    .every((segment) => segment !== '..' && segment !== '' && !isWindowsHostileSegment(segment));
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
