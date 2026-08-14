/**
 * Directories the workspace scan must never walk into.
 *
 * The intelligence index calls `vscode.workspace.findFiles` with this as its
 * exclude glob. The list used to cover the usual build and dependency output —
 * `.git`, `node_modules`, `vendor`, `target`, `dist`, `build`, `.next`,
 * `coverage` — which is right until a repository keeps git worktrees inside
 * itself.
 *
 * This one does. `.worktrees/` holds a full checkout per in-flight branch, and
 * on the machine where this was found it contained **2,042,172 files**. The
 * scan walked all of them, so every run stalled at "Reading workspace" and
 * never reached its first model turn. The directory is listed in `.gitignore`,
 * but `findFiles` does not consult `.gitignore` — the exclude glob is the only
 * thing that stops it, so the entry has to be here.
 *
 * The rest are the same class of mistake waiting to happen: caches and
 * artifacts that are large, uninteresting to the model, and cheap to skip.
 */
export const WORKSPACE_SCAN_EXCLUDED_DIRECTORIES: readonly string[] = [
  '.git',
  '.worktrees',
  'node_modules',
  'vendor',
  'target',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
  '.cache',
  '.venv',
  '__pycache__',
];

export const WORKSPACE_SCAN_EXCLUDE_GLOB = `**/{${WORKSPACE_SCAN_EXCLUDED_DIRECTORIES.join(',')}}/**`;

/**
 * Upper bound on files returned by a single workspace scan.
 *
 * Kept as a second line of defence: even with the exclusions above, a
 * repository can be larger than the index is useful for, and a scan that
 * returns everything is a scan that finishes too late to matter.
 */
export const WORKSPACE_SCAN_MAX_RESULTS = 50_000;
