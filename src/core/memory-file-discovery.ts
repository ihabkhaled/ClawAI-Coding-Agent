/** The `.clawai` files that carry standing guidance, in the order they are read. */
export const MEMORY_FILE_NAMES = ['rules.md', 'architecture.md', 'memory.md'] as const;

/** How many directory levels below the workspace root are searched. */
export const MAX_MEMORY_DEPTH = 8;

/**
 * The directories to look in, workspace root first and nearest last.
 *
 * Root first is the precedence, not just the order: guidance nearer the file
 * being worked on is more specific, so it is read last and therefore speaks
 * last. A repository-wide rule and a rule for one package are both true, and
 * when they disagree the package is the one that meant it.
 *
 * The walk is bounded and stays inside the workspace: a relative path is split
 * on `/`, and anything that tries to climb out with `..` or an absolute
 * segment yields the root alone rather than an escape.
 */
export function memoryDirectories(relativeFilePath: string | undefined): string[] {
  const directories = [''];
  if (relativeFilePath === undefined) return directories;
  const normalized = relativeFilePath.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.includes('..')) return directories;
  const segments = normalized.split('/').slice(0, -1).filter(Boolean);
  let current = '';
  for (const segment of segments.slice(0, MAX_MEMORY_DEPTH)) {
    current = current.length === 0 ? segment : `${current}/${segment}`;
    directories.push(current);
  }
  return directories;
}

/**
 * Every memory file worth trying, weakest first.
 *
 * Emitted rather than read here: which of these exist is a filesystem
 * question, and keeping the ordering pure is what makes the precedence
 * testable without a workspace.
 */
export function memoryFileCandidates(relativeFilePath: string | undefined): string[] {
  return memoryDirectories(relativeFilePath).flatMap((directory) =>
    MEMORY_FILE_NAMES.map((name) =>
      directory.length === 0 ? `.clawai/${name}` : `${directory}/.clawai/${name}`,
    ),
  );
}
