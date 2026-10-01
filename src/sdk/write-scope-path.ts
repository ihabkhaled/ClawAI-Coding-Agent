import { spawnSync } from 'node:child_process';
import { env } from 'node:process';

import { inheritedEnvironment } from '../core/inherited-environment';
import { prepareGitSpawn } from '../infrastructure/hardened-git';

import { WRITE_SCOPE_GIT_MAX_BUFFER, WRITE_SCOPE_GIT_TIMEOUT_MS } from './write-scope.constants';

const TRAILING_DOTS_AND_SPACES = /[. ]+$/u;
const WILDCARD = /[*?]/u;

/**
 * One path segment as NTFS would resolve it: an alternate data stream
 * (`name::$DATA`, `name:stream`) is the file itself, and trailing dots and
 * spaces are dropped by Win32 name parsing.
 */
function ntfsSegment(segment: string): string {
  const colon = segment.indexOf(':');
  const base = colon === -1 ? segment : segment.slice(0, colon);
  return base.replace(TRAILING_DOTS_AND_SPACES, '');
}

/**
 * A workspace-relative path in the one spelling the globs are matched against:
 * forward slashes, no `.` segments, and, when `windowsNames` is set, NTFS stream
 * suffixes and trailing dots or spaces removed. `..` segments are kept so an
 * escape is still seen as one.
 */
export function normalizeScopedPath(relative: string, windowsNames: boolean): string {
  const kept: string[] = [];
  for (const raw of relative.replaceAll('\\', '/').split('/')) {
    if (raw === '.') continue;
    const segment = raw === '..' || !windowsNames ? raw : ntfsSegment(raw);
    if (segment !== '') kept.push(segment);
  }
  return kept.join('/');
}

/**
 * Directories a deny glob protects as a whole: the literal leading segments of
 * every deny glob, so `src/secrets/**` protects `src/secrets` and `src`. A glob
 * without wildcards names a file, so only its ancestors count.
 */
export function protectedDirectories(denyGlobs: readonly string[]): readonly string[] {
  const found = new Set<string>();
  for (const glob of denyGlobs) {
    const literal: string[] = [];
    for (const segment of glob.split('/')) {
      if (WILDCARD.test(segment)) break;
      literal.push(segment);
      found.add(literal.join('/'));
    }
    if (!WILDCARD.test(glob)) found.delete(glob);
  }
  return [...found];
}

/** Modified paths below a restore pathspec, per `git diff`; empty when git cannot say. */
export function modifiedUnder(workspace: string, pathspec: string): readonly string[] {
  try {
    const prepared = prepareGitSpawn(
      'git',
      ['diff', '--name-only', '-z', '--', pathspec],
      workspace,
      inheritedEnvironment(env),
    );
    const finished = spawnSync('git', prepared.arguments, {
      cwd: workspace,
      encoding: 'utf8',
      timeout: WRITE_SCOPE_GIT_TIMEOUT_MS,
      maxBuffer: WRITE_SCOPE_GIT_MAX_BUFFER,
      shell: false,
      windowsHide: true,
      env: { ...prepared.environment, GIT_LITERAL_PATHSPECS: '1' },
    });
    if (finished.status !== 0 || typeof finished.stdout !== 'string') return [];
    return finished.stdout.split('\0').filter((name) => name !== '');
  } catch {
    return [];
  }
}
