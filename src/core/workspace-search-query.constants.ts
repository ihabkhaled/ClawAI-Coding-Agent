/**
 * Language names a search may scope to, and the extensions each one covers.
 *
 * Named types exist because the extensions are the part nobody remembers. A
 * model asked to search "the TypeScript files" writes `ts`, not
 * `**\/*.{ts,tsx,mts,cts}`, and a glob it half-remembers silently searches
 * fewer files than it thinks — which reads as absence, the one answer a search
 * must never fake.
 *
 * Raw extensions are also accepted, so this table never has to be exhaustive
 * to be useful.
 */
export const SEARCH_FILE_TYPES: Readonly<Record<string, readonly string[]>> = {
  c: ['c', 'h'],
  cpp: ['cc', 'cpp', 'cxx', 'hh', 'hpp', 'hxx'],
  cs: ['cs'],
  css: ['css', 'sass', 'scss'],
  go: ['go'],
  html: ['htm', 'html'],
  java: ['java'],
  js: ['cjs', 'js', 'jsx', 'mjs'],
  json: ['json', 'jsonc'],
  kotlin: ['kt', 'kts'],
  md: ['markdown', 'md'],
  php: ['php'],
  py: ['py', 'pyi'],
  rb: ['rb'],
  rust: ['rs'],
  sh: ['bash', 'sh', 'zsh'],
  sql: ['sql'],
  swift: ['swift'],
  toml: ['toml'],
  ts: ['cts', 'mts', 'ts', 'tsx'],
  yaml: ['yaml', 'yml'],
};

/**
 * How much of a file a multiline pattern may run against.
 *
 * A per-line search is bounded by the line; a pattern that spans lines has no
 * such ceiling, and a nested quantifier over a megabyte of minified source is
 * the input that turns a search into a hang. Sixty-four kilobytes covers real
 * source files and is small enough that a pathological pattern fails fast.
 */
export const MAX_MULTILINE_SCAN_BYTES = 64 * 1024;

/** Matches one caller may take from a single file before the search moves on. */
export const MAX_MULTILINE_MATCHES_PER_FILE = 20;
