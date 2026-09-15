import path from 'node:path';

import { HEADLESS_DEFAULT_EXECUTABLES } from './headless-command-policy.constants';

/**
 * Whether a headless run may spawn this command.
 *
 * The check is on the bare name, and a name carrying any path separator is
 * refused outright. Allowing `../../bin/sh` to satisfy an allowlist entry for
 * `sh` would make the allowlist decorative, and resolving it first would only
 * move the question to which directory won.
 *
 * Matching is case-insensitive and ignores a Windows executable extension, so
 * `NODE.EXE` is the same decision as `node`. Treating them differently would
 * mean the same invocation is permitted on one platform and refused on another.
 */
export function isAllowedExecutable(executable: string, allowed: readonly string[]): boolean {
  if (executable.length === 0) return false;
  if (executable.includes('/') || executable.includes('\\')) return false;
  const name = path.parse(executable.toLowerCase()).name;
  return allowed.some((candidate) => path.parse(candidate.toLowerCase()).name === name);
}

/**
 * The allowlist for this invocation: the defaults plus whatever was asked for.
 *
 * Additive rather than replacing, so widening the set cannot accidentally
 * remove the commands the run already depended on.
 */
export function allowedExecutables(additional: readonly string[]): readonly string[] {
  return [...HEADLESS_DEFAULT_EXECUTABLES, ...additional.filter((name) => name.length > 0)];
}
