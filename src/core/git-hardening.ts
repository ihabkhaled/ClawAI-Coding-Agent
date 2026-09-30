import {
  GIT_HARDENED_ENVIRONMENT,
  GIT_NEUTRALISING_CONFIG,
  GIT_READ_SAFETY_FLAGS,
  GIT_STRIPPED_ENVIRONMENT,
  PROGRAM_CONFIG_KEYS,
} from './git-hardening.constants';

import type { HardenedGitCommand } from './git-hardening.types';

/** True for `git`, `git.exe` and any path ending in them. */
export function isGitExecutable(executable: string): boolean {
  const name = (executable.split(/[\\/]/u).pop() ?? '').toLowerCase();
  return name === 'git' || name === 'git.exe';
}

/** The `-c key=value` pairs that stop a repository choosing what git runs. */
export function gitNeutralisingArguments(hooksPath: string): string[] {
  return [...GIT_NEUTRALISING_CONFIG, `core.hooksPath=${hooksPath}`].flatMap((pair) => [
    '-c',
    pair,
  ]);
}

/** Puts the neutralising config first, and read-safety flags after the subcommand. */
export function hardenedGitArguments(args: readonly string[], hooksPath: string): string[] {
  const subcommand = args.find((argument) => !argument.startsWith('-'));
  const extra = subcommand === undefined ? undefined : GIT_READ_SAFETY_FLAGS[subcommand];
  const index = subcommand === undefined ? -1 : args.indexOf(subcommand);
  const rest =
    extra === undefined || index < 0
      ? [...args]
      : [...args.slice(0, index + 1), ...extra, ...args.slice(index + 1)];
  return [...gitNeutralisingArguments(hooksPath), ...rest];
}

/** Drops every inherited variable that names a program, then pins the safe ones. */
export function hardenedGitEnvironment(
  base: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const stripped = new Set(GIT_STRIPPED_ENVIRONMENT);
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !stripped.has(key.toUpperCase())) environment[key] = value;
  }
  return { ...environment, ...GIT_HARDENED_ENVIRONMENT };
}

/**
 * The one place a git invocation is made safe. Anything that is not git passes
 * through untouched, so callers can route every spawn here without branching.
 */
export function hardenGitCommand(
  executable: string,
  args: readonly string[],
  base: Readonly<Record<string, string | undefined>>,
  hooksPath: string,
): HardenedGitCommand {
  if (!isGitExecutable(executable)) {
    return { arguments: [...args], environment: { ...base } as Record<string, string> };
  }
  return {
    arguments: hardenedGitArguments(args, hooksPath),
    environment: hardenedGitEnvironment(base),
  };
}

/** Config keys in a repository's own config that would run a program. */
export function programSpawningConfigKeys(configText: string): string[] {
  const found: string[] = [];
  let section = '';
  for (const raw of configText.split(/\r?\n/u)) {
    const line = raw.trim();
    const header = /^\[\s*([^\s\]"]+)(?:\s+"(.*)")?\s*\]/u.exec(line);
    if (header !== null) {
      const name = (header[1] ?? '').toLowerCase();
      section = header[2] === undefined ? name : `${name}.${header[2].toLowerCase()}`;
      continue;
    }
    const entry = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$/u.exec(line);
    const key = entry?.[1]?.toLowerCase();
    if (key === undefined) continue;
    const full = `${section}.${key}`;
    if (isBenignLfsFilter(full, entry?.[2] ?? '')) continue;
    if (PROGRAM_CONFIG_KEYS.some((pattern) => pattern.test(full))) found.push(full);
  }
  return found;
}

/** git-lfs installs its own filter into repo config; that is not repo-chosen code. */
function isBenignLfsFilter(key: string, value: string): boolean {
  return key.startsWith('filter.lfs.') && /^"?git-lfs\s/u.test(value.trim());
}
