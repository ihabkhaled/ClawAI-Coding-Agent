import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { platform as hostPlatform } from 'node:process';

import { GIT_MATCH_EVERYTHING_PATTERN } from './git-tools.constants';
import { stagedPaths } from './write-scope-git';
import { modifiedUnder, normalizeScopedPath, protectedDirectories } from './write-scope-path';
import {
  WRITE_SCOPE_ALWAYS_DENY,
  WRITE_SCOPE_CASE_INSENSITIVE_PLATFORMS,
  WRITE_SCOPE_FILE_FIELDS,
  WRITE_SCOPE_GIT_PATH_OPERATIONS,
  WRITE_SCOPE_MAX_GLOBS,
  WRITE_SCOPE_MAX_GLOB_CHARS,
  WRITE_SCOPE_MAX_REPORTED,
  WRITE_SCOPE_MESSAGE_GLOBS,
} from './write-scope.constants';

import type { AgentToolCall } from './agent-sdk.types';
import type { WriteScope, WriteScopeConfig, WriteScopeOptions } from './write-scope.types';

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/gu;

/** A glob as the scope stores it: forward slashes, no leading `./`, a trailing `/` meaning "everything below". */
export function normalizeGlob(pattern: string): string {
  const slashed = pattern
    .trim()
    .replaceAll('\\', '/')
    .replace(/^(?:\.\/)+/u, '');
  return slashed.endsWith('/') ? `${slashed}**` : slashed;
}

function globProblem(pattern: string): string | undefined {
  const glob = normalizeGlob(pattern);
  if (glob.length === 0) return 'A write-scope glob is empty.';
  if (glob.length > WRITE_SCOPE_MAX_GLOB_CHARS || glob.includes('\0')) {
    return `A write-scope glob is 1 to ${String(WRITE_SCOPE_MAX_GLOB_CHARS)} characters.`;
  }
  if (glob.startsWith('/') || /^[a-zA-Z]:/u.test(glob)) {
    return `Write-scope glob "${pattern}" must be relative to the workspace.`;
  }
  if (glob.split('/').includes('..')) {
    return `Write-scope glob "${pattern}" must stay inside the workspace (no "..").`;
  }
  return undefined;
}

/** The message naming what is wrong with the two glob lists, or undefined when they are usable. */
export function writeScopeProblem(
  scope: readonly string[],
  deny: readonly string[],
): string | undefined {
  if (scope.length > WRITE_SCOPE_MAX_GLOBS || deny.length > WRITE_SCOPE_MAX_GLOBS) {
    return `At most ${String(WRITE_SCOPE_MAX_GLOBS)} write-scope globs are allowed per list.`;
  }
  for (const pattern of [...scope, ...deny]) {
    const problem = globProblem(pattern);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

function globToken(glob: string, index: number): { source: string; next: number } {
  const char = glob.charAt(index);
  if (char === '?') return { source: '[^/]', next: index + 1 };
  if (char !== '*')
    return { source: char.replaceAll(REGEX_SPECIALS, String.raw`\$&`), next: index + 1 };
  if (glob.charAt(index + 1) !== '*') return { source: '[^/]*', next: index + 1 };
  // `**/` is any number of directories, including none; a bare `**` is anything.
  return glob.charAt(index + 2) === '/'
    ? { source: '(?:[^/]+/)*', next: index + 3 }
    : { source: '.*', next: index + 2 };
}

/**
 * A workspace-relative, forward-slash glob as an anchored matcher: `*` and `?`
 * stay inside one path segment, `**` crosses them. Every other character is
 * escaped, so a pattern is never a regular expression of the operator's making.
 */
export function compileGlob(pattern: string, caseInsensitive: boolean): RegExp {
  const glob = normalizeGlob(pattern);
  let source = '';
  for (let index = 0; index < glob.length;) {
    const token = globToken(glob, index);
    source += token.source;
    index = token.next;
  }
  return new RegExp(`^${source}$`, caseInsensitive ? 'iu' : 'u');
}

function compileScope(
  scope: readonly string[],
  deny: readonly string[],
  options: WriteScopeOptions,
): WriteScope {
  const platform = options.platform ?? hostPlatform;
  const insensitive = WRITE_SCOPE_CASE_INSENSITIVE_PLATFORMS.includes(platform);
  const denied = [...WRITE_SCOPE_ALWAYS_DENY, ...deny];
  return {
    scopeGlobs: scope,
    denyGlobs: deny.length === 0 && scope.length === 0 ? ['.git/**'] : deny,
    allow: (scope.length === 0 ? ['**'] : scope).map((glob) => compileGlob(glob, insensitive)),
    deny: denied.map((glob) => compileGlob(glob, insensitive)),
    protectedDirs: protectedDirectories(denied),
    windowsNames: platform === 'win32',
    insensitive,
    onViolation: options.onViolation,
  };
}

/**
 * The compiled scope, or undefined when nothing restricts writes. A `deny`
 * with no `scope` means "anywhere except there". Throws a RangeError for a
 * glob that is not usable, so a bad value fails at start, not mid-run.
 */
export function createWriteScope(
  config: WriteScopeConfig,
  options: WriteScopeOptions = {},
): WriteScope | undefined {
  const scope = (config.scope ?? []).map(normalizeGlob);
  const deny = (config.deny ?? []).map(normalizeGlob);
  if (scope.length === 0 && deny.length === 0 && options.alwaysGuard !== true) return undefined;
  const problem = writeScopeProblem(scope, deny);
  if (problem !== undefined) throw new RangeError(problem);
  return compileScope(scope, deny, options);
}

function escapesWorkspace(relative: string): boolean {
  return relative === '' || relative === '..' || relative.startsWith('../');
}

/** Whether a workspace-relative, forward-slash path may be changed. */
export function pathInScope(scope: WriteScope, raw: string): boolean {
  const relative = normalizeScopedPath(raw, scope.windowsNames);
  if (escapesWorkspace(relative)) return false;
  return (
    scope.allow.some((glob) => glob.test(relative)) &&
    !scope.deny.some((glob) => glob.test(relative))
  );
}

/** Whether a deny glob covers this directory as a whole, or something below it. */
export function protectsDenied(scope: WriteScope, raw: string): boolean {
  const relative = normalizeScopedPath(raw, scope.windowsNames);
  const fold = (text: string): string => (scope.insensitive ? text.toLowerCase() : text);
  return scope.protectedDirs.some((dir) => fold(dir) === fold(relative));
}

function posixRelative(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join('/');
}

/** Where a path would really land: the nearest existing ancestor resolved, the rest appended. */
function realRelative(workspace: string, lexical: string): string {
  try {
    const root = realpathSync.native(workspace);
    const target = path.resolve(root, lexical);
    let existing = target;
    const tail: string[] = [];
    while (lstatSync(existing, { throwIfNoEntry: false }) === undefined) {
      const parent = path.dirname(existing);
      if (parent === existing) return lexical;
      tail.unshift(path.basename(existing));
      existing = parent;
    }
    return posixRelative(root, path.join(realpathSync.native(existing), ...tail));
  } catch {
    return lexical;
  }
}

/**
 * The paths a raw argument answers to: the one written, and the one it lands
 * on after symbolic links. A link inside the scope that points out of it must
 * not carry a write across, so both have to be in scope.
 */
export function pathCandidates(workspace: string, raw: string): readonly string[] {
  const root = path.resolve(workspace);
  const lexical = posixRelative(root, path.resolve(root, raw.trim()));
  if (escapesWorkspace(lexical)) return [lexical];
  return [...new Set([lexical, realRelative(root, lexical)])];
}

/** The written form of a path for a message: workspace-relative, forward-slash. */
function shownPath(workspace: string, raw: string): string {
  return pathCandidates(workspace, raw)[0] ?? raw;
}

function allowedPath(scope: WriteScope, workspace: string, raw: string): boolean {
  return pathCandidates(workspace, raw).every((candidate) => pathInScope(scope, candidate));
}

function limitedGlobs(globs: readonly string[]): string {
  const shown = globs.slice(0, WRITE_SCOPE_MESSAGE_GLOBS).join(', ');
  const more = globs.length - WRITE_SCOPE_MESSAGE_GLOBS;
  return more > 0 ? `${shown}, and ${String(more)} more` : shown;
}

/** The refusal the model reads; it says what may change and what to do instead. */
export function scopeRefusal(label: string, shown: string, scope: WriteScope): string {
  const allowed =
    scope.scopeGlobs.length === 0
      ? `You may change anything except: ${limitedGlobs(scope.denyGlobs)}.`
      : `You may only change: ${limitedGlobs(scope.scopeGlobs)}.`;
  const where = scope.scopeGlobs.length === 0 ? 'denied by' : 'outside';
  return `${label} refused: "${shown}" is ${where} the write scope. ${allowed} If this file really needs to change, say so in your final report instead of editing it.`;
}

function refuseOutside(
  tool: string,
  operation: string,
  raws: readonly string[],
  workspace: string,
  scope: WriteScope,
): void {
  const outside = raws.filter((raw) => !allowedPath(scope, workspace, raw));
  if (outside.length === 0) return;
  const shown = outside.map((raw) => shownPath(workspace, raw));
  scope.onViolation?.({ tool, paths: shown.slice(0, WRITE_SCOPE_MAX_REPORTED) });
  throw new Error(scopeRefusal(`${tool} ${operation}`, shown[0] ?? '', scope));
}

function refuseProtected(
  tool: string,
  operation: string,
  raws: readonly string[],
  workspace: string,
  scope: WriteScope,
): void {
  const hit = raws.find((raw) =>
    pathCandidates(workspace, raw).some((candidate) => protectsDenied(scope, candidate)),
  );
  if (hit === undefined) return;
  const shown = shownPath(workspace, hit);
  scope.onViolation?.({ tool, paths: [shown] });
  throw new Error(
    `${tool} ${operation} refused: "${shown}" is a directory the write scope protects (a denied path lives in or below it). Say so in your final report instead of moving, deleting or restoring it.`,
  );
}

function refuseRestoreOfDenied(
  paths: readonly string[],
  workspace: string,
  scope: WriteScope,
): void {
  refuseProtected('workspace.git', 'restore', paths, workspace, scope);
  for (const raw of paths) {
    const denied = modifiedUnder(workspace, shownPath(workspace, raw)).filter(
      (name) => !pathInScope(scope, name),
    );
    if (denied.length === 0) continue;
    scope.onViolation?.({
      tool: 'workspace.git',
      paths: denied.slice(0, WRITE_SCOPE_MAX_REPORTED),
    });
    throw new Error(
      `workspace.git restore refused: "${raw}" covers paths outside the write scope (${denied.slice(0, WRITE_SCOPE_MESSAGE_GLOBS).join(', ')}) and would discard their edits. Name the files you may change.`,
    );
  }
}

function textValues(values: readonly unknown[]): string[] {
  return values.filter((value): value is string => typeof value === 'string');
}

/** A git path the scope can judge; flags, pathspec magic and "everything" are left to git's own refusal. */
function isNamedGitPath(value: string): boolean {
  const trimmed = value.trim();
  return !/^[-:]/u.test(trimmed) && !GIT_MATCH_EVERYTHING_PATTERN.test(trimmed);
}

function commitRefusal(workspace: string, scope: WriteScope): void {
  const staged = stagedPaths(workspace);
  const outside = (staged ?? []).filter((name) => !pathInScope(scope, name));
  if (outside.length === 0) return;
  scope.onViolation?.({ tool: 'workspace.git', paths: outside.slice(0, WRITE_SCOPE_MAX_REPORTED) });
  const scopeText =
    scope.scopeGlobs.length === 0
      ? `You may change anything except: ${limitedGlobs(scope.denyGlobs)}.`
      : `You may only change: ${limitedGlobs(scope.scopeGlobs)}.`;
  throw new Error(
    `workspace.git commit refused: the staged set has paths outside the write scope: ${outside.slice(0, WRITE_SCOPE_MESSAGE_GLOBS).join(', ')}. ${scopeText} Nothing was committed; say so in your final report instead of committing them.`,
  );
}

/**
 * Throws, with a message the model can act on, when a call would change a path
 * outside the scope. `workspace.file` create, update, delete and rename (both
 * ends), `workspace.git` add, unstage and restore, and a commit whose staged
 * set reaches outside. Reads and every other call pass.
 */
export function assertScopedCall(call: AgentToolCall, workspace: string, scope: WriteScope): void {
  const args = call.arguments;
  if (call.toolName === 'workspace.file') {
    const fields = WRITE_SCOPE_FILE_FIELDS[call.operation] ?? [];
    refuseOutside(
      'workspace.file',
      call.operation,
      textValues(fields.map((f) => args[f])),
      workspace,
      scope,
    );
    if (call.operation === 'delete' || call.operation === 'rename') {
      refuseProtected('workspace.file', call.operation, textValues([args.path]), workspace, scope);
    }
    return;
  }
  if (call.toolName !== 'workspace.git') return;
  if (WRITE_SCOPE_GIT_PATH_OPERATIONS.includes(call.operation)) {
    const paths = Array.isArray(args.paths) ? textValues(args.paths).filter(isNamedGitPath) : [];
    refuseOutside('workspace.git', call.operation, paths, workspace, scope);
    if (call.operation === 'restore') refuseRestoreOfDenied(paths, workspace, scope);
  } else if (call.operation === 'commit') {
    commitRefusal(workspace, scope);
  }
}
