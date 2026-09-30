import path from 'node:path';

import { FILE_PATTERN_MAX_CHARS } from './file-tools.constants';

import type { FileToolArguments } from './file-tools.types';

/**
 * Refuses a call that named no file.
 *
 * A missing `path` used to fall back to `.`, which resolves to the workspace
 * directory itself, so a write failed with EISDIR — a message about
 * directories that says nothing about the actual mistake. Naming the missing
 * argument lets the model correct itself on the next turn.
 */
export function requirePath(operation: string, args: FileToolArguments): string {
  const value = args.path;
  if (typeof value === 'string' && value.trim().length > 0) return value;
  const provided = Object.keys(args).join(', ');
  throw new Error(
    `workspace.file ${operation} requires a "path" argument. Received: ${provided.length > 0 ? provided : 'nothing'}.`,
  );
}

/** A required non-empty string argument, named in the error when it is not one. */
export function requireText(operation: string, args: FileToolArguments, name: string): string {
  const value = args[name];
  if (typeof value === 'string' && value.length > 0) return value;
  throw new Error(`workspace.file ${operation} requires a non-empty "${name}" argument.`);
}

/** An optional string argument; a present value of another type is an error. */
export function optionalText(
  operation: string,
  args: FileToolArguments,
  name: string,
): string | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  throw new Error(`workspace.file ${operation}: "${name}" must be a string.`);
}

/** An optional integer within `[min, max]`; anything else is an error naming the argument. */
export function optionalInteger(
  operation: string,
  args: FileToolArguments,
  name: string,
  min: number,
  max: number,
): number | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max) {
    return value;
  }
  throw new Error(
    `workspace.file ${operation}: "${name}" must be an integer from ${String(min)} to ${String(max)}.`,
  );
}

/** An optional boolean; a present value of another type is an error. */
export function optionalFlag(
  operation: string,
  args: FileToolArguments,
  name: string,
): boolean | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  throw new Error(`workspace.file ${operation}: "${name}" must be true or false.`);
}

/** A path relative to the workspace, with forward slashes whatever the platform. */
export function workspaceRelative(root: string, absolute: string): string {
  const relative = path.relative(root, absolute);
  return relative === '' ? '.' : relative.split(path.sep).join('/');
}

/**
 * Compiles a glob to a matcher: `*` within a segment, `**` across segments,
 * `?` one character, `{a,b}` alternatives. Every other character is escaped,
 * so the result has no nested quantifier a pattern could abuse.
 *
 * A pattern with no `/` matches the file name at any depth, so `*.ts` finds
 * every TypeScript file rather than only those at the top.
 */
export function compileGlob(operation: string, argument: string, pattern: string): RegExp {
  if (pattern.length === 0 || pattern.length > FILE_PATTERN_MAX_CHARS) {
    throw new Error(
      `workspace.file ${operation}: "${argument}" must be 1 to ${String(FILE_PATTERN_MAX_CHARS)} characters.`,
    );
  }
  const normalized = pattern.replaceAll('\\', '/');
  const body = globBody(normalized);
  const prefix = normalized.includes('/') ? '' : '(?:.*/)?';
  return new RegExp(`^${prefix}${body}$`, 'u');
}

const GLOB_TOKENS: Readonly<Record<string, string>> = { '*': '[^/]*', '?': '[^/]', '{': '(?:' };

/** One character of a glob outside a `**`: a wildcard, a brace, or an escaped literal. */
function globToken(char: string, braces: number): string {
  const wildcard = GLOB_TOKENS[char];
  if (wildcard !== undefined) return wildcard;
  if (char === '}' && braces > 0) return ')';
  if (char === ',' && braces > 0) return '|';
  return char.replaceAll(/[.+^$()|[\]\\{}]/gu, String.raw`\$&`);
}

function globBody(pattern: string): string {
  let out = '';
  let braces = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern.charAt(index);
    if (char === '*' && pattern.charAt(index + 1) === '*') {
      const slash = pattern.charAt(index + 2) === '/';
      out += slash ? '(?:.*/)?' : '.*';
      index += slash ? 2 : 1;
      continue;
    }
    out += globToken(char, braces);
    if (char === '{') braces += 1;
    else if (char === '}' && braces > 0) braces -= 1;
  }
  return out + ')'.repeat(braces);
}
