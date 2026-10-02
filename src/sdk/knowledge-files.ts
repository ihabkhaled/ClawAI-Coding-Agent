import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { isSensitiveWorkspacePath } from '../core/workspace-path-policy';

import { createIgnoreStack } from './knowledge-ignore';
import {
  KNOWLEDGE_DIRECTORY_EXTENSIONS,
  KNOWLEDGE_DIRECTORY_KINDS,
  KNOWLEDGE_MARKDOWN_EXTENSIONS,
  KNOWLEDGE_ROOT_FILES,
  KNOWLEDGE_SKIPPED_DIRECTORIES,
  KNOWLEDGE_WALK_MAX_DEPTH,
  KNOWLEDGE_WALK_MAX_ENTRIES,
  KNOWLEDGE_WALK_MAX_FILES,
} from './knowledge-tool.constants';

import type { IgnoreStack } from './knowledge-ignore';
import type { KnowledgeFile, KnowledgeKind, KnowledgeListing } from './knowledge-tool.types';
import type { Dirent } from 'node:fs';

const INSTRUCTION_NAMES: ReadonlySet<string> = new Set(
  KNOWLEDGE_ROOT_FILES.map((name) => name.toLowerCase()),
);

/** The workspace-relative path with forward slashes and no leading `./`. */
export function posixPath(relative: string): string {
  return relative.replace(/\\/gu, '/').replace(/^(?:\.\/)+/u, '');
}

/** Whether a path crosses a directory the walk never enters. */
export function inSkippedDirectory(relative: string): boolean {
  return posixPath(relative)
    .split('/')
    .slice(0, -1)
    .some((segment) => KNOWLEDGE_SKIPPED_DIRECTORIES.has(segment));
}

function directoryKind(segments: readonly string[]): KnowledgeKind | undefined {
  for (const segment of segments.slice(0, -1)) {
    const kind = KNOWLEDGE_DIRECTORY_KINDS[segment];
    if (kind !== undefined) return kind;
  }
  return undefined;
}

/**
 * Whether a path looks like it holds credentials. A document ABOUT secrets
 * (`rules/21-security-and-secrets.md`) is exactly what the agent should read, so
 * a markdown file is judged by its directories only; every other file by its
 * whole path.
 */
function isSensitiveKnowledgePath(segments: readonly string[], extension: string): boolean {
  if (KNOWLEDGE_MARKDOWN_EXTENSIONS.has(extension)) {
    const directories = segments.slice(0, -1).join('/');
    return directories.length > 0 && isSensitiveWorkspacePath(directories);
  }
  return isSensitiveWorkspacePath(segments.join('/'));
}

/**
 * The kind of a knowledge file, or undefined when the path is not knowledge.
 *
 * Markdown is knowledge wherever it lives; other text is knowledge only inside
 * rules/, skills/, context/, docs/, memory/ and .ai/. Credential-shaped paths
 * and anything under a skipped directory never are, and nothing reads code.
 */
export function knowledgeKind(relative: string): KnowledgeKind | undefined {
  const posix = posixPath(relative);
  if (posix.length === 0 || posix.split('/').includes('..')) return undefined;
  if (inSkippedDirectory(posix)) return undefined;
  const segments = posix.split('/');
  const name = segments.at(-1) ?? '';
  const extension = path.posix.extname(name).toLowerCase();
  if (isSensitiveKnowledgePath(segments, extension)) return undefined;
  if (INSTRUCTION_NAMES.has(name.toLowerCase())) return 'instruction';
  const inDirectory = directoryKind(segments);
  if (inDirectory !== undefined && KNOWLEDGE_DIRECTORY_EXTENSIONS.has(extension)) {
    return inDirectory;
  }
  return KNOWLEDGE_MARKDOWN_EXTENSIONS.has(extension) ? 'other' : undefined;
}

interface Pending {
  readonly directory: string;
  readonly depth: number;
}

/** Reads a .gitignore if there is one; a missing or unreadable one is no rules. */
function ignoreText(absolute: string): string {
  try {
    return readFileSync(path.join(absolute, '.gitignore'), 'utf8');
  } catch {
    return '';
  }
}

function sizeOf(absolute: string): number | undefined {
  try {
    const info = statSync(absolute);
    return info.isFile() ? info.size : undefined;
  } catch {
    return undefined;
  }
}

interface WalkState {
  readonly workspace: string;
  readonly ignore: IgnoreStack;
  readonly files: KnowledgeFile[];
  readonly queue: Pending[];
  visited: number;
  truncated: boolean;
}

function sortedEntries(absolute: string): Dirent[] {
  try {
    return readdirSync(absolute, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    );
  } catch {
    return [];
  }
}

function visit(state: WalkState, from: Pending, entry: Dirent): void {
  if (entry.isSymbolicLink()) return;
  const relative = from.directory.length === 0 ? entry.name : `${from.directory}/${entry.name}`;
  if (entry.isDirectory()) {
    const skip =
      KNOWLEDGE_SKIPPED_DIRECTORIES.has(entry.name) || state.ignore.ignored(relative, true);
    if (!skip && from.depth < KNOWLEDGE_WALK_MAX_DEPTH) {
      state.queue.push({ directory: relative, depth: from.depth + 1 });
    }
    return;
  }
  if (!entry.isFile() || state.ignore.ignored(relative, false)) return;
  const kind = knowledgeKind(relative);
  const bytes = kind === undefined ? undefined : sizeOf(path.join(state.workspace, relative));
  if (kind !== undefined && bytes !== undefined) state.files.push({ path: relative, bytes, kind });
}

/**
 * A bounded walk of the workspace for knowledge files.
 *
 * Breadth first, so shallow files (the root instruction files, rules/) are
 * found before a limit can stop the walk. Honours every .gitignore met on the
 * way, never enters node_modules, dist, .git and the like, never follows a
 * symbolic link and never reads a file.
 */
export function listKnowledgeFiles(workspace: string, signal?: AbortSignal): KnowledgeListing {
  const state: WalkState = {
    workspace,
    ignore: createIgnoreStack(),
    files: [],
    queue: [{ directory: '', depth: 0 }],
    visited: 0,
    truncated: false,
  };
  for (let next = state.queue.shift(); next !== undefined; next = state.queue.shift()) {
    signal?.throwIfAborted();
    const absolute = path.join(workspace, next.directory);
    state.ignore.add(next.directory, ignoreText(absolute));
    for (const entry of sortedEntries(absolute)) {
      state.visited += 1;
      if (
        state.visited > KNOWLEDGE_WALK_MAX_ENTRIES ||
        state.files.length >= KNOWLEDGE_WALK_MAX_FILES
      ) {
        state.truncated = true;
        break;
      }
      visit(state, next, entry);
    }
    if (state.truncated) break;
  }
  return { files: state.files, visited: state.visited, truncated: state.truncated };
}
