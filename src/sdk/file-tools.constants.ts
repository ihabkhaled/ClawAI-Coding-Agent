import { HEADLESS_MAX_CONTENT_BYTES } from '../headless/headless-session.constants';

/**
 * The most characters `read` returns when asked for the most, always cut at a
 * line boundary. Reached only through the optional `maxChars` argument.
 */
export const FILE_READ_MAX_CHARS = 48_000;

/**
 * The characters `read` returns when `maxChars` is not given. Tool results are
 * billed cumulatively against the run's result budget, so the default slice is
 * small and the model follows `nextLine` when it needs more.
 */
export const FILE_READ_DEFAULT_CHARS = 8_000;

/** The smallest `maxChars` a read accepts. */
export const FILE_READ_MIN_CHARS = 500;

/** Files larger than this are refused by `read`; the model is told to use ranges or search. */
export const FILE_READ_MAX_BYTES = 5 * 1024 * 1024;

/** Files larger than this cannot be edited by `update`. */
export const FILE_UPDATE_MAX_BYTES = 5 * 1024 * 1024;

/** The most entries `list` returns. */
export const FILE_LIST_MAX_ENTRIES = 400;

/** The deepest `list` recurses, whatever is asked. */
export const FILE_LIST_MAX_DEPTH = 4;

/** The depth `list` uses when `recursive` is true and no depth is given. */
export const FILE_LIST_DEFAULT_RECURSIVE_DEPTH = 3;

/** The most paths `glob` returns. */
export const FILE_GLOB_MAX_RESULTS = 500;

/** The most matches `search` returns. */
export const FILE_SEARCH_MAX_MATCHES = 100;

/** Matching lines are cut to this many characters. */
export const FILE_SEARCH_LINE_CHARS = 200;

/** Files larger than this are skipped by `search`. */
export const FILE_SEARCH_MAX_FILE_BYTES = 1024 * 1024;

/** Lines are truncated to this before a regular expression sees them. */
export const FILE_SEARCH_REGEX_LINE_CHARS = 4_000;

/** The longest regular expression or glob accepted. */
export const FILE_PATTERN_MAX_CHARS = 300;

/** Most wildcards (`*`, `?`, `{`) a glob may hold; each one multiplies the matching work. */
export const FILE_GLOB_MAX_WILDCARDS = 8;

/** Most quantifiers (`*`, `+`, `?`, `{n,m}`) a search regex may hold. */
export const FILE_REGEX_MAX_QUANTIFIERS = 8;

/** Longest stretch of synchronous matching before a search yields to the event loop. */
export const FILE_SLICE_MS = 15;

/** How long a walk (search or glob) may run before it returns what it has. */
export const FILE_WALK_BUDGET_MS = 8_000;

/** The most directory entries one walk visits, so a huge tree cannot run away. */
export const FILE_WALK_MAX_ENTRIES = 100_000;

/** How much of the start of a file is inspected to decide it is binary. */
export const FILE_BINARY_SNIFF_BYTES = 8_000;

/** Directories that hold generated or vendored content; skipped by list, glob and search. */
export const FILE_IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.next',
]);

/** The ceiling on the serialized size of any tool result. */
export const TOOL_RESULT_MAX_CHARS = 60_000;

/** Appended to a string field that was cut by the result guard. */
export const TOOL_RESULT_CUT_MARKER = '...[truncated]';

/** The smallest per-string cap the result guard will try before giving up on fields. */
export const TOOL_RESULT_MIN_FIELD_CHARS = 200;

const LINE_NUMBER = { type: 'integer', minimum: 1, maximum: 100_000_000 } as const;
const PATTERN_TEXT = { type: 'string', minLength: 1, maxLength: FILE_PATTERN_MAX_CHARS } as const;

/** Category of each `workspace.file` operation. */
export const FILE_TOOL_OPERATIONS = {
  read: 'read',
  list: 'read',
  glob: 'read',
  search: 'read',
  stat: 'read',
  create: 'write',
  update: 'write',
  delete: 'write',
  rename: 'write',
} as const;

/** What the model is told about `workspace.file`; it is the only documentation it gets. */
export const FILE_TOOL_DESCRIPTION = [
  'Work with files in the workspace. All paths are relative to the workspace root.',
  'read {path, startLine?, endLine?, maxChars?} or {path, offset?, limit?, maxChars?}: returns lines (8000 characters by default, up to 48000 with maxChars; cut at a line; follow nextLine to continue). Every result counts against the result budget of the run: prefer search, glob and small ranges, and do not re-read a file you already have. Binary files are refused.',
  'list {path?, recursive?, depth?}: entries with type and size; skips .git, node_modules, dist, coverage, .next; max 400.',
  'glob {pattern, path?}: file paths matching e.g. **/*.ts (a pattern with no / matches names at any depth); max 500.',
  'search {query | regex, path?, include?, caseSensitive?}: matching lines as {path, line, text}; max 100; skips binary and files over 1 MB.',
  'stat {path}: exists, type, size, mtime.',
  'create {path, content}: write a whole file (overwrites, creates folders).',
  'update {path, oldText, newText, expectedCount?, replaceAll?}: exact text replace. Fails if oldText is missing or matches more than expectedCount (default 1) times; include surrounding lines to make it unique. Line endings are preserved. Prefer update to create for existing files.',
  'delete {path}: delete one file. rename {path, to}: move a file or folder; fails if the target exists.',
].join('\n');

/** The JSON schema for every `workspace.file` argument; each is used by the operations named above. */
export const FILE_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', maxLength: 4096 },
    to: { type: 'string', maxLength: 4096 },
    content: { type: 'string', maxLength: HEADLESS_MAX_CONTENT_BYTES },
    startLine: LINE_NUMBER,
    endLine: LINE_NUMBER,
    offset: { type: 'integer', minimum: 0, maximum: 100_000_000 },
    limit: LINE_NUMBER,
    maxChars: { type: 'integer', minimum: FILE_READ_MIN_CHARS, maximum: FILE_READ_MAX_CHARS },
    recursive: { type: 'boolean' },
    depth: { type: 'integer', minimum: 1, maximum: FILE_LIST_MAX_DEPTH },
    pattern: PATTERN_TEXT,
    query: PATTERN_TEXT,
    regex: PATTERN_TEXT,
    include: PATTERN_TEXT,
    caseSensitive: { type: 'boolean' },
    oldText: { type: 'string', minLength: 1, maxLength: HEADLESS_MAX_CONTENT_BYTES },
    newText: { type: 'string', maxLength: HEADLESS_MAX_CONTENT_BYTES },
    expectedCount: { type: 'integer', minimum: 1, maximum: 1_000_000 },
    replaceAll: { type: 'boolean' },
  },
} as const;
