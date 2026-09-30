import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { containedPath } from '../core/workspace-containment';

import {
  optionalFlag,
  optionalInteger,
  optionalText,
  requirePath,
  workspaceRelative,
} from './file-tools-args';
import { isBinaryFile } from './file-tools-search';
import {
  FILE_IGNORED_DIRECTORIES,
  FILE_LIST_DEFAULT_RECURSIVE_DEPTH,
  FILE_LIST_MAX_DEPTH,
  FILE_LIST_MAX_ENTRIES,
  FILE_READ_DEFAULT_CHARS,
  FILE_READ_MAX_BYTES,
  FILE_READ_MAX_CHARS,
  FILE_READ_MIN_CHARS,
} from './file-tools.constants';

import type {
  FileBinaryResult,
  FileListEntry,
  FileReadResult,
  FileToolArguments,
} from './file-tools.types';
import type { Dirent, Stats } from 'node:fs';

const LINE_LIMIT = 100_000_000;

function statOf(target: string): Stats | undefined {
  return lstatSync(target, { throwIfNoEntry: false });
}

/** The lines a read asked for: `startLine`/`endLine` (1-based, inclusive) or `offset`/`limit`. */
function requestedRange(args: FileToolArguments): { start: number; end: number } {
  const startLine = optionalInteger('read', args, 'startLine', 1, LINE_LIMIT);
  const endLine = optionalInteger('read', args, 'endLine', 1, LINE_LIMIT);
  const offset = optionalInteger('read', args, 'offset', 0, LINE_LIMIT);
  const limit = optionalInteger('read', args, 'limit', 1, LINE_LIMIT);
  const start = startLine ?? (offset ?? 0) + 1;
  const end = endLine ?? (limit === undefined ? LINE_LIMIT : start + limit - 1);
  if (end < start) {
    throw new Error(
      `workspace.file read: "endLine" ${String(end)} is before "startLine" ${String(start)}.`,
    );
  }
  return { start, end };
}

function fileLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/** The lines from `start` to `last` that fit the ceiling; a lone oversized line is cut. */
function takeLines(
  lines: readonly string[],
  start: number,
  last: number,
  ceiling: number,
): { taken: string[]; cutLine: boolean } {
  const taken: string[] = [];
  let used = 0;
  for (let number = start; number <= last; number += 1) {
    const line = lines[number - 1] ?? '';
    if (used + line.length + 1 > ceiling) {
      if (taken.length > 0) return { taken, cutLine: false };
      return { taken: [line.slice(0, ceiling)], cutLine: true };
    }
    taken.push(line);
    used += line.length + 1;
  }
  return { taken, cutLine: false };
}

function readHints(
  start: number,
  cutLine: boolean,
  nextLine: number | undefined,
  ceiling: number,
): string[] {
  const hints: string[] = [];
  if (cutLine) {
    hints.push(`Line ${String(start)} is longer than ${String(ceiling)} characters and was cut.`);
  }
  if (nextLine !== undefined) hints.push(`Continue with startLine=${String(nextLine)}.`);
  return hints;
}

/**
 * The slice of `lines` from `start`, cut at a line boundary so the content
 * never exceeds the read ceiling. A single line longer than the ceiling is
 * the one exception: it is cut mid-line and the hint says so.
 */
function sliceLines(
  relative: string,
  lines: readonly string[],
  range: { start: number; end: number },
  ceiling: number,
): FileReadResult {
  const total = lines.length;
  if (total > 0 && range.start > total) {
    throw new Error(
      `workspace.file read: "startLine" ${String(range.start)} is past the end of ${relative} (${String(total)} lines).`,
    );
  }
  const last = Math.min(range.end, total);
  const { taken, cutLine } = takeLines(lines, range.start, last, ceiling);
  const endLine = range.start + taken.length - 1;
  const truncated = cutLine || endLine < last;
  const nextLine = endLine < total ? endLine + 1 : undefined;
  const hints = readHints(range.start, cutLine, nextLine, ceiling);
  return {
    path: relative,
    content: taken.join('\n'),
    startLine: range.start,
    endLine,
    totalLines: total,
    truncated,
    ...(nextLine === undefined ? {} : { nextLine }),
    ...(hints.length === 0 ? {} : { hint: hints.join(' ') }),
  };
}

/** Reads one text file, never returning more than the read ceiling. */
export function readFileTool(
  args: FileToolArguments,
  workspace: string,
): FileReadResult | FileBinaryResult {
  const relative = requirePath('read', args);
  const target = containedPath(workspace, relative);
  const stats = statOf(target);
  if (stats === undefined) {
    throw new Error(`workspace.file read: "path" ${relative} does not exist.`);
  }
  if (stats.isDirectory()) {
    throw new Error(
      `workspace.file read: "path" ${relative} is a directory; use the list operation.`,
    );
  }
  if (!stats.isFile())
    throw new Error(`workspace.file read: "path" ${relative} is not a regular file.`);
  if (stats.size > FILE_READ_MAX_BYTES) {
    throw new Error(
      `workspace.file read: ${relative} is ${String(stats.size)} bytes, over the ${String(FILE_READ_MAX_BYTES)}-byte read limit. Use search to find the part you need, then read it with startLine and endLine.`,
    );
  }
  if (isBinaryFile(target)) {
    return {
      path: relative,
      content: '',
      binary: true,
      size: stats.size,
      note: 'Binary file: its contents are not shown. Use stat for its size.',
    };
  }
  const ceiling =
    optionalInteger('read', args, 'maxChars', FILE_READ_MIN_CHARS, FILE_READ_MAX_CHARS) ??
    FILE_READ_DEFAULT_CHARS;
  return sliceLines(
    relative,
    fileLines(readFileSync(target, 'utf8')),
    requestedRange(args),
    ceiling,
  );
}

/** The type and size of a path, or `exists: false`; never an error for a missing path. */
export function statFileTool(args: FileToolArguments, workspace: string): Record<string, unknown> {
  const relative = requirePath('stat', args);
  const stats = statOf(containedPath(workspace, relative));
  if (stats === undefined) return { path: relative, exists: false };
  return {
    path: relative,
    exists: true,
    type: stats.isDirectory() ? 'dir' : stats.isFile() ? 'file' : 'other',
    size: stats.size,
    mtime: stats.mtime.toISOString(),
  };
}

function entryFor(root: string, absolute: string, entry: Dirent): FileListEntry {
  const relative = workspaceRelative(root, absolute);
  if (entry.isDirectory()) return { path: relative, type: 'dir' };
  if (entry.isSymbolicLink()) return { path: relative, type: 'symlink' };
  return { path: relative, type: 'file', size: lstatSync(absolute).size };
}

function collect(
  root: string,
  directory: string,
  level: number,
  depth: number,
  out: FileListEntry[],
): boolean {
  const children = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const child of children) {
    if (child.isDirectory() && FILE_IGNORED_DIRECTORIES.has(child.name)) continue;
    if (out.length >= FILE_LIST_MAX_ENTRIES) return true;
    const absolute = path.join(directory, child.name);
    out.push(entryFor(root, absolute, child));
    if (child.isDirectory() && level < depth && collect(root, absolute, level + 1, depth, out)) {
      return true;
    }
  }
  return false;
}

/** Lists a directory, optionally to a depth, skipping generated directories. */
export function listFiles(
  args: FileToolArguments,
  workspace: string,
  root: string,
): Record<string, unknown> {
  const requested = optionalText('list', args, 'path');
  const relative = requested === undefined || requested === '' ? '.' : requested;
  const base = containedPath(workspace, relative);
  const stats = statOf(base);
  if (stats === undefined)
    throw new Error(`workspace.file list: "path" ${relative} does not exist.`);
  if (!stats.isDirectory()) {
    throw new Error(`workspace.file list: "path" ${relative} is not a directory; use read.`);
  }
  const recursive = optionalFlag('list', args, 'recursive') === true;
  const asked = optionalInteger('list', args, 'depth', 1, 1_000);
  const depth = Math.min(
    asked ?? (recursive ? FILE_LIST_DEFAULT_RECURSIVE_DEPTH : 1),
    FILE_LIST_MAX_DEPTH,
  );
  const entries: FileListEntry[] = [];
  const truncated = collect(root, base, 1, depth, entries);
  return {
    path: workspaceRelative(root, base),
    entries,
    truncated,
    ...(truncated
      ? {
          hint: `Only ${String(FILE_LIST_MAX_ENTRIES)} entries are listed. Narrow "path" or use glob.`,
        }
      : {}),
  };
}
