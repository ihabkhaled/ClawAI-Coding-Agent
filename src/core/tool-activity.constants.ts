/**
 * Argument names that carry the thing a call is about, most specific first.
 *
 * Read in order, so a call that names both a path and a query is described by
 * its path. Order is the whole design here: the first match wins, and a list
 * sorted by how concrete each name is gives the most useful line without a
 * rule per tool.
 */
export const TOOL_SUBJECT_KEYS: readonly string[] = [
  'path',
  'file',
  'filePath',
  'command',
  'url',
  'query',
  'pattern',
  'name',
  'target',
  'id',
];

/**
 * Argument names holding a list of subjects, when no single one is named.
 *
 * A call that edits four files should say four files, not fall through to its
 * tool name and tell the reader nothing.
 */
export const TOOL_SUBJECT_LIST_KEYS: readonly string[] = ['paths', 'files', 'operations'];

/** How long a subject may be before it is shortened for a single line. */
export const TOOL_SUBJECT_MAX_LENGTH = 80;
