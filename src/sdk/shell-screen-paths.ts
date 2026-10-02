import path from 'node:path';

import type { ScreenContext } from './shell-tool.types';

/** One command found in a script: its name and the words after it, up to the next separator. */
export interface ScriptCommand {
  readonly name: string;
  readonly words: readonly string[];
}

const DEVICE_TARGET = /^(?:\/dev\/(?:null|stdout|stderr|tty|zero)|nul|\$null|&[0-9-]+)$/u;
const EXPANDING_TARGET = /^[~$%`]/u;
const ABSOLUTE_TARGET = /^(?:[/\\]|[a-z]:)/u;
/** Git Bash and MSYS spell `C:\x` as `/c/x`. */
const MSYS_DRIVE = /^\/([a-z])(?:\/(.*))?$/u;

function pathModule(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** Whether `target` is `directory` or somewhere under it. */
export function containsPath(
  platform: NodeJS.Platform,
  directory: string,
  target: string,
): boolean {
  const relative = pathModule(platform).relative(directory, target);
  return (
    relative === '' || (!relative.startsWith('..') && !pathModule(platform).isAbsolute(relative))
  );
}

/** `/c/Users/x` as `C:/Users/x` on Windows; other paths unchanged. */
function nativeTarget(target: string, platform: NodeJS.Platform): string {
  if (platform !== 'win32') return target;
  const drive = MSYS_DRIVE.exec(target);
  if (drive?.[1] === undefined) return target;
  return `${drive[1].toUpperCase()}:/${drive[2] ?? ''}`;
}

/** The path a word names once resolved, or undefined when it is not one that can be resolved here. */
function resolvedTarget(word: string, context: ScreenContext): string | undefined {
  const modulePath = pathModule(context.platform);
  const pwd = /^\$(?:\{pwd\}|pwd|\(pwd\))(?:\/(.*))?$/u.exec(word);
  if (pwd !== null) return modulePath.resolve(context.cwd, pwd[1] ?? '.');
  if (EXPANDING_TARGET.test(word)) return undefined;
  if (ABSOLUTE_TARGET.test(word)) return modulePath.resolve(nativeTarget(word, context.platform));
  return modulePath.resolve(context.cwd, word);
}

/**
 * Whether a path word points outside the workspace (and outside the temporary
 * directories, where scratch files belong). A word that expands at run time
 * (`~`, `$HOME`, `%X%`) cannot be resolved, so it counts as outside.
 */
export function isOutsideWorkspace(word: string, context: ScreenContext): boolean {
  const target = word.trim().replace(/[);]+$/u, '');
  if (target.length === 0 || DEVICE_TARGET.test(target)) return false;
  const resolved = resolvedTarget(target, context);
  if (resolved === undefined) return true;
  if (containsPath(context.platform, context.workspace, resolved)) return false;
  return !context.temporary.some((directory) =>
    containsPath(context.platform, directory, resolved),
  );
}

/** Whether a word is the workspace itself or its `.git` directory: never a thing to delete. */
export function isProtectedTarget(word: string, context: ScreenContext): boolean {
  const target = word.trim().replace(/[);]+$/u, '');
  const resolved = target.length === 0 ? undefined : resolvedTarget(target, context);
  if (resolved === undefined) return false;
  const modulePath = pathModule(context.platform);
  const root = modulePath.resolve(context.workspace);
  const norm = (value: string): string =>
    context.platform === 'win32' ? value.toLowerCase() : value;
  return norm(resolved) === norm(root) || norm(resolved) === norm(modulePath.join(root, '.git'));
}

/**
 * Every use of one of `names` as a command, with its words.
 *
 * A command starts at the beginning of the script or after `;`, `&`, `|`, `(`,
 * `$(`, a backtick or a line break, and ends at the next of those. Quotes were
 * already removed, so a quoted word with a space splits; for a screen that errs
 * toward looking at more words, which is the safe side.
 */
export function commandsNamed(plain: string, names: readonly string[]): ScriptCommand[] {
  const pattern = new RegExp(
    `(?:^|[;&|(\\n\`]|\\$\\()\\s*(?:(?:sudo|doas|xargs|command|exec|time|nohup)\\s+)*(${names.join('|')})(?![a-z0-9_-])([^;&|\\n]*)`,
    'gu',
  );
  return [...plain.matchAll(pattern)].map((match) => ({
    name: match[1] ?? '',
    words: (match[2] ?? '')
      .trim()
      .split(/\s+/u)
      .filter((word) => word.length > 0),
  }));
}

/** The targets of redirections (`> file`, `>> file`, `2> file`), `&1`-style duplications left out. */
export function redirectTargets(plain: string): string[] {
  return [...plain.matchAll(/(?<![<=>-])[0-9]?>>?\|?\s*([^\s;&|)<>]+)/gu)]
    .map((match) => match[1] ?? '')
    .filter((target) => target.length > 0 && !target.startsWith('&'));
}
