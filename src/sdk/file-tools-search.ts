import { lstatSync, openSync, readSync, closeSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { containedPath } from '../core/workspace-containment';

import {
  compileGlob,
  optionalFlag,
  optionalText,
  requireText,
  workspaceRelative,
} from './file-tools-args';
import {
  FILE_BINARY_SNIFF_BYTES,
  FILE_GLOB_MAX_RESULTS,
  FILE_IGNORED_DIRECTORIES,
  FILE_PATTERN_MAX_CHARS,
  FILE_SEARCH_LINE_CHARS,
  FILE_SEARCH_MAX_FILE_BYTES,
  FILE_SEARCH_MAX_MATCHES,
  FILE_SEARCH_REGEX_LINE_CHARS,
  FILE_WALK_BUDGET_MS,
  FILE_WALK_MAX_ENTRIES,
} from './file-tools.constants';

import type {
  FileSearchMatch,
  FileToolArguments,
  WalkBounds,
  WalkState,
  WalkedFile,
} from './file-tools.types';

/** Whether the start of a file contains a NUL byte, which text never does. */
export function isBinaryFile(absolute: string): boolean {
  const descriptor = openSync(absolute, 'r');
  try {
    const buffer = Buffer.alloc(FILE_BINARY_SNIFF_BYTES);
    const read = readSync(descriptor, buffer, 0, FILE_BINARY_SNIFF_BYTES, 0);
    return buffer.subarray(0, read).includes(0);
  } finally {
    closeSync(descriptor);
  }
}

function newBounds(): WalkBounds {
  return { deadline: Date.now() + FILE_WALK_BUDGET_MS, maxEntries: FILE_WALK_MAX_ENTRIES };
}

/**
 * The regular files under `start`, in name order.
 *
 * Symbolic links are neither followed nor reported, so a link inside the
 * workspace cannot lead a walk outside it. Ignored directories are never
 * entered. The walk stops, and says so in `state`, when it runs out of time or
 * entries, so an enormous tree returns what it has instead of hanging.
 */
function* walkFiles(
  root: string,
  start: string,
  state: WalkState,
  bounds: WalkBounds,
): Generator<WalkedFile> {
  const names = readdirSync(start, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of names) {
    state.visited += 1;
    if (state.visited > bounds.maxEntries || Date.now() > bounds.deadline) {
      state.timedOut = true;
      return;
    }
    const absolute = path.join(start, entry.name);
    if (entry.isDirectory() && !FILE_IGNORED_DIRECTORIES.has(entry.name)) {
      yield* walkFiles(root, absolute, state, bounds);
      if (state.timedOut) return;
    } else if (entry.isFile()) {
      yield {
        absolute,
        relative: workspaceRelative(root, absolute),
        size: lstatSync(absolute).size,
      };
    }
  }
}

interface SearchScope {
  readonly root: string;
  readonly base: string;
  readonly baseRelative: string;
  readonly files: Generator<WalkedFile>;
  readonly state: WalkState;
}

function searchScope(
  operation: string,
  args: FileToolArguments,
  workspace: string,
  root: string,
): SearchScope {
  const requested = optionalText(operation, args, 'path');
  const base = containedPath(
    workspace,
    requested === undefined || requested === '' ? '.' : requested,
  );
  const stats = lstatSync(base, { throwIfNoEntry: false });
  if (stats === undefined) {
    throw new Error(`workspace.file ${operation}: "path" ${requested ?? '.'} does not exist.`);
  }
  const state: WalkState = { timedOut: false, visited: 0 };
  const single = function* (): Generator<WalkedFile> {
    yield { absolute: base, relative: workspaceRelative(root, base), size: stats.size };
  };
  return {
    root,
    base,
    baseRelative: workspaceRelative(root, base),
    files: stats.isDirectory() ? walkFiles(root, base, state, newBounds()) : single(),
    state,
  };
}

/** Matches a glob against the path relative to the searched directory. */
function relativeToBase(scope: SearchScope, file: WalkedFile): string {
  return file.absolute === scope.base
    ? path.basename(file.absolute)
    : workspaceRelative(scope.base, file.absolute);
}

/** Files whose path matches `pattern`, at most 500, in name order. */
export function globFiles(
  args: FileToolArguments,
  workspace: string,
  root: string,
): Record<string, unknown> {
  const pattern = requireText('glob', args, 'pattern');
  const matcher = compileGlob('glob', 'pattern', pattern);
  const scope = searchScope('glob', args, workspace, root);
  const paths: string[] = [];
  let truncated = false;
  for (const file of scope.files) {
    if (!matcher.test(relativeToBase(scope, file))) continue;
    if (paths.length >= FILE_GLOB_MAX_RESULTS) {
      truncated = true;
      break;
    }
    paths.push(file.relative);
  }
  return {
    pattern,
    paths,
    truncated: truncated || scope.state.timedOut,
    ...(truncated ? { hint: 'More files match. Narrow the pattern or the path.' } : {}),
  };
}

/** How a search decides a line matches. */
function lineMatcher(args: FileToolArguments): RegExp {
  const query = optionalText('search', args, 'query');
  const regex = optionalText('search', args, 'regex');
  if ((query === undefined || query === '') === (regex === undefined || regex === '')) {
    throw new Error('workspace.file search requires exactly one of "query" (literal) or "regex".');
  }
  const source = regex ?? query ?? '';
  if (source.length > FILE_PATTERN_MAX_CHARS) {
    throw new Error(
      `workspace.file search: the pattern is longer than ${String(FILE_PATTERN_MAX_CHARS)} characters.`,
    );
  }
  const flags = optionalFlag('search', args, 'caseSensitive') === true ? 'u' : 'iu';
  const body = regex ?? source.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  try {
    return new RegExp(body, flags);
  } catch {
    throw new Error('workspace.file search: "regex" is not a valid regular expression.');
  }
}

/** The part of a matching line worth showing: the start, or a window around a late match. */
function excerpt(line: string, index: number): string {
  const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
  const from = index > FILE_SEARCH_LINE_CHARS - 50 ? index - 50 : 0;
  return clean.slice(from, from + FILE_SEARCH_LINE_CHARS);
}

function matchesIn(file: WalkedFile, matcher: RegExp, room: number): FileSearchMatch[] {
  const found: FileSearchMatch[] = [];
  const lines = readFileSync(file.absolute, 'utf8').split('\n');
  for (let index = 0; index < lines.length && found.length < room; index += 1) {
    const line = (lines[index] ?? '').slice(0, FILE_SEARCH_REGEX_LINE_CHARS);
    const hit = matcher.exec(line);
    if (hit !== null) {
      found.push({ path: file.relative, line: index + 1, text: excerpt(line, hit.index) });
    }
  }
  return found;
}

/** Literal or regular-expression search over text files, bounded in matches and time. */
export function searchFiles(
  args: FileToolArguments,
  workspace: string,
  root: string,
): Record<string, unknown> {
  const matcher = lineMatcher(args);
  const includeText = optionalText('search', args, 'include');
  const include =
    includeText === undefined || includeText === ''
      ? undefined
      : compileGlob('search', 'include', includeText);
  const scope = searchScope('search', args, workspace, root);
  const matches: FileSearchMatch[] = [];
  let scanned = 0;
  let skipped = 0;
  let truncated = false;
  for (const file of scope.files) {
    if (include !== undefined && !include.test(relativeToBase(scope, file))) continue;
    if (file.size > FILE_SEARCH_MAX_FILE_BYTES || isBinaryFile(file.absolute)) {
      skipped += 1;
      continue;
    }
    scanned += 1;
    matches.push(...matchesIn(file, matcher, FILE_SEARCH_MAX_MATCHES + 1 - matches.length));
    if (matches.length > FILE_SEARCH_MAX_MATCHES) {
      truncated = true;
      matches.length = FILE_SEARCH_MAX_MATCHES;
      break;
    }
  }
  return {
    matches,
    truncated,
    filesScanned: scanned,
    filesSkipped: skipped,
    ...(scope.state.timedOut ? { timedOut: true } : {}),
    ...(truncated
      ? { hint: 'More matches exist. Narrow "path" or "include", or refine the query.' }
      : {}),
  };
}
