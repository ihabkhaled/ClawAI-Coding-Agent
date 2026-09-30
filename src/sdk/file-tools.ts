import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { containedPath } from '../core/workspace-containment';

import { optionalFlag, optionalInteger, requirePath, requireText } from './file-tools-args';
import { listFiles, readFileTool, statFileTool } from './file-tools-read';
import { globFiles, searchFiles } from './file-tools-search';
import { FILE_UPDATE_MAX_BYTES } from './file-tools.constants';

import type { FileToolArguments } from './file-tools.types';

export { requirePath } from './file-tools-args';

/**
 * Runs one `workspace.file` operation inside `workspace`.
 *
 * Every path is resolved with `containedPath`, so traversal and symbolic
 * links are refused before anything is touched, and every result is bounded.
 */
export function runFileTool(
  operation: string,
  args: FileToolArguments,
  workspace: string,
): unknown {
  const root = realpathSync(workspace);
  switch (operation) {
    case 'read':
      return readFileTool(args, workspace);
    case 'list':
      return listFiles(args, workspace, root);
    case 'glob':
      return globFiles(args, workspace, root);
    case 'search':
      return searchFiles(args, workspace, root);
    case 'stat':
      return statFileTool(args, workspace);
    case 'create':
      return createFile(args, workspace);
    case 'update':
      return updateFile(args, workspace);
    case 'delete':
      return deleteFile(args, workspace, root);
    case 'rename':
      return renameFile(args, workspace, root);
    default:
      throw new Error(`Unsupported operation ${operation}`);
  }
}

function createFile(args: FileToolArguments, workspace: string): unknown {
  const relative = requirePath('create', args);
  const target = containedPath(workspace, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, typeof args.content === 'string' ? args.content : '', 'utf8');
  return { written: relative };
}

/** Occurrences of `needle` in `haystack`, not overlapping. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = haystack.indexOf(needle);
  while (from !== -1) {
    count += 1;
    from = haystack.indexOf(needle, from + needle.length);
  }
  return count;
}

/** A file that is entirely CRLF: every line feed is preceded by a carriage return. */
function isPureCrlf(text: string): boolean {
  const feeds = countOccurrences(text, '\n');
  return feeds > 0 && countOccurrences(text, '\r\n') === feeds;
}

function existingFile(operation: string, relative: string, target: string): number {
  const stats = lstatSync(target, { throwIfNoEntry: false });
  if (stats === undefined) {
    throw new Error(`workspace.file ${operation}: "path" ${relative} does not exist.`);
  }
  if (!stats.isFile()) {
    throw new Error(`workspace.file ${operation}: "path" ${relative} is not a file.`);
  }
  return stats.size;
}

/**
 * Exact-text replacement that fails loudly instead of guessing.
 *
 * A file that uses CRLF throughout is edited as LF and written back as CRLF,
 * so the model can send `oldText` with plain newlines and the file's line
 * endings survive. Zero matches and an unexpected count are both errors that
 * say what to change, because a silent no-op is how an agent believes it edited.
 */
function updateFile(args: FileToolArguments, workspace: string): unknown {
  const relative = requirePath('update', args);
  const target = containedPath(workspace, relative);
  if (existingFile('update', relative, target) > FILE_UPDATE_MAX_BYTES) {
    throw new Error(`workspace.file update: ${relative} is too large to edit with update.`);
  }
  const oldText = requireText('update', args, 'oldText');
  const newText =
    typeof args.newText === 'string' ? args.newText : requireText('update', args, 'newText');
  const raw = readFileSync(target, 'utf8');
  const crlf = isPureCrlf(raw);
  const lf = (value: string): string => (crlf ? value.replaceAll('\r\n', '\n') : value);
  const source = lf(raw);
  const found = countOccurrences(source, lf(oldText));
  const expected = optionalInteger('update', args, 'expectedCount', 1, 1_000_000);
  const all = optionalFlag('update', args, 'replaceAll') === true;
  assertCount(relative, found, expected, all);
  const replaced = all
    ? source.replaceAll(lf(oldText), () => lf(newText))
    : source.replace(lf(oldText), () => lf(newText));
  writeFileSync(target, crlf ? replaced.replaceAll('\n', '\r\n') : replaced, 'utf8');
  return { path: relative, replacements: all ? found : 1 };
}

function assertCount(
  relative: string,
  found: number,
  expected: number | undefined,
  all: boolean,
): void {
  if (found === 0) {
    throw new Error(
      `workspace.file update: "oldText" was not found in ${relative}. Read the file again and copy the exact text, including whitespace.`,
    );
  }
  const wanted = expected ?? (all ? found : 1);
  if (found !== wanted) {
    throw new Error(
      `workspace.file update: "oldText" matches ${String(found)} times in ${relative} but ${String(wanted)} ${wanted === 1 ? 'was' : 'were'} expected. Add surrounding lines to make it unique, or set "replaceAll" or "expectedCount".`,
    );
  }
}

function deleteFile(args: FileToolArguments, workspace: string, root: string): unknown {
  const relative = requirePath('delete', args);
  const target = containedPath(workspace, relative);
  if (target === root)
    throw new Error('workspace.file delete: the workspace root cannot be deleted.');
  existingFile('delete', relative, target);
  unlinkSync(target);
  return { deleted: relative };
}

function renameFile(args: FileToolArguments, workspace: string, root: string): unknown {
  const relative = requirePath('rename', args);
  const destination = requireText('rename', args, 'to');
  const source = containedPath(workspace, relative);
  const target = containedPath(workspace, destination);
  if (source === root || target === root) {
    throw new Error('workspace.file rename: the workspace root cannot be renamed.');
  }
  if (lstatSync(source, { throwIfNoEntry: false }) === undefined) {
    throw new Error(`workspace.file rename: "path" ${relative} does not exist.`);
  }
  if (lstatSync(target, { throwIfNoEntry: false }) !== undefined) {
    throw new Error(`workspace.file rename: "to" ${destination} already exists.`);
  }
  mkdirSync(path.dirname(target), { recursive: true });
  renameSync(source, target);
  return { renamed: relative, to: destination };
}
