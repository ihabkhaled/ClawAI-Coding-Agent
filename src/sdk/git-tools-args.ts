import path from 'node:path';

import { containedPath } from '../core/workspace-containment';

import {
  GIT_BRANCH_PATTERN,
  GIT_MATCH_EVERYTHING_PATTERN,
  GIT_MAX_BODY_CHARS,
  GIT_MAX_HEADER_CHARS,
  GIT_MAX_PATHS,
  GIT_MAX_REF_CHARS,
  GIT_MAX_TRAILER_CHARS,
  GIT_MAX_TRAILERS,
  GIT_MAX_TIMEOUT_SECONDS,
  GIT_REF_PATTERN,
  GIT_TRAILER_PATTERN,
} from './git-tools.constants';

import type { GitCommitMessage } from './git-tools.types';

type ToolArguments = Readonly<Record<string, unknown>>;

/**
 * Explicit, workspace-relative paths for a staging operation.
 *
 * Refused: nothing named, the workspace itself, anything made only of wildcard
 * and dot characters, anything that reads as a flag or as pathspec magic, and
 * anything outside the workspace. What reaches git is a list of plain paths
 * behind `--`, run with literal pathspecs, so a name like `[id]` means itself.
 */
export function explicitPaths(operation: string, args: ToolArguments, workspace: string): string[] {
  const raw = args.paths;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`workspace.git ${operation} requires a non-empty "paths" array.`);
  }
  if (raw.length > GIT_MAX_PATHS) {
    throw new Error(`workspace.git ${operation} accepts at most ${String(GIT_MAX_PATHS)} paths.`);
  }
  return raw.map((entry) => explicitPath(operation, entry, workspace));
}

function explicitPath(operation: string, entry: unknown, workspace: string): string {
  if (typeof entry !== 'string') throw new Error(`workspace.git ${operation}: paths are strings.`);
  const value = entry.trim();
  if (value.startsWith('-') || value.startsWith(':')) {
    throw new Error(`workspace.git ${operation}: "${value}" is a flag, not a path.`);
  }
  if (GIT_MATCH_EVERYTHING_PATTERN.test(value)) {
    throw new Error(
      `workspace.git ${operation}: "${value}" would match everything; name each path.`,
    );
  }
  const relative = path.relative(workspace, containedPath(workspace, value));
  if (relative.length === 0) {
    throw new Error(`workspace.git ${operation}: the workspace itself is not a path.`);
  }
  return relative;
}

/** A branch name that cannot be a flag, a refspec, or a path. */
export function branchName(operation: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`workspace.git ${operation} requires a "branch" name.`);
  }
  const problem = branchProblem(value);
  if (problem !== undefined) throw new Error(`workspace.git ${operation}: branch ${problem}.`);
  return value;
}

function branchProblem(value: string): string | undefined {
  if (value.length > GIT_MAX_REF_CHARS) return 'name is too long';
  if (!GIT_BRANCH_PATTERN.test(value)) return `name "${value}" is not allowed`;
  if (value.includes('..') || value.includes('//') || value.includes('@{')) {
    return `name "${value}" is not allowed`;
  }
  if (value.endsWith('/') || value.endsWith('.') || value.endsWith('.lock')) {
    return `name "${value}" is not allowed`;
  }
  return undefined;
}

/** A revision for `show`. */
export function revision(value: unknown): string {
  if (value === undefined) return 'HEAD';
  if (
    typeof value !== 'string' ||
    value.length > GIT_MAX_REF_CHARS ||
    !GIT_REF_PATTERN.test(value)
  ) {
    throw new Error('workspace.git show: "ref" is not an allowed revision.');
  }
  return value;
}

/** How long a slow operation may run: the caller's request inside 1 second to 60 minutes. */
export function timeoutMilliseconds(args: ToolArguments, fallback: number): number {
  const requested = args.timeoutSeconds;
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return fallback;
  return Math.min(Math.max(Math.trunc(requested), 1), GIT_MAX_TIMEOUT_SECONDS) * 1000;
}

/** The message a commit carries: one header line, an optional body, Co-Authored-By trailers. */
export function commitMessage(args: ToolArguments): GitCommitMessage {
  const header = typeof args.message === 'string' ? args.message.trim() : '';
  if (header.length === 0) throw new Error('workspace.git commit requires a "message".');
  if (header.length > GIT_MAX_HEADER_CHARS || /[\r\n\0]/u.test(header)) {
    throw new Error(
      `workspace.git commit: "message" is one line of at most ${String(GIT_MAX_HEADER_CHARS)} characters; put detail in "body".`,
    );
  }
  return { header, body: commitBody(args.body), trailers: commitTrailers(args.trailers) };
}

function commitBody(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > GIT_MAX_BODY_CHARS || value.includes('\0')) {
    throw new Error(
      `workspace.git commit: "body" is text of at most ${String(GIT_MAX_BODY_CHARS)} characters.`,
    );
  }
  return value.trim();
}

function commitTrailers(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > GIT_MAX_TRAILERS) {
    throw new Error(
      `workspace.git commit: "trailers" is at most ${String(GIT_MAX_TRAILERS)} lines.`,
    );
  }
  return value.map((entry) => {
    const line = typeof entry === 'string' ? entry.trim() : '';
    if (line.length > GIT_MAX_TRAILER_CHARS || !GIT_TRAILER_PATTERN.test(line)) {
      throw new Error(
        'workspace.git commit: only "Co-Authored-By: Name <email>" trailers are allowed.',
      );
    }
    return line;
  });
}

/** The commit message as git stores it: header, blank line, body, blank line, trailers. */
export function formatCommitMessage(message: GitCommitMessage): string {
  const parts = [message.header];
  if (message.body.length > 0) parts.push(message.body);
  if (message.trailers.length > 0) parts.push(message.trailers.join('\n'));
  return `${parts.join('\n\n')}\n`;
}
