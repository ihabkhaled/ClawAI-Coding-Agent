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

/**
 * How many files a single `workspace.files search` may open.
 *
 * This used to be the same number as the result cap, because one `maxResults`
 * argument was passed to `findFiles` and then used again to slice the matches.
 * A result cap of 100 therefore meant a *candidate* cap of 100: a search of
 * this repository read 100 of its 8,059 files, about one percent, and reported
 * nothing found. That reads to a model exactly like proof of absence, and the
 * model moves on. Nothing in the output said only a hundred files were opened.
 *
 * The two limits answer different questions — how much work the search may do,
 * and how much of it the model is shown — so they are two numbers now. The
 * output carries `scannedFiles` so a saturated scan is visible rather than
 * inferred.
 */
export const WORKSPACE_SEARCH_MAX_CANDIDATE_FILES = 5_000;

/**
 * Total decoded bytes one search may read before it stops and says so.
 *
 * The candidate cap alone is not a cost bound: five thousand large files is a
 * stalled run. Whichever limit is reached first ends the scan, and either way
 * the result reports truncation instead of implying the workspace was covered.
 */
export const WORKSPACE_SEARCH_MAX_SCANNED_BYTES = 32 * 1024 * 1024;
