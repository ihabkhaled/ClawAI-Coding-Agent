import { existsSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  hardenedGitArguments,
  hardenedGitEnvironment,
  hardenedGitWriteArguments,
  isGitExecutable,
  programSpawningConfigKeys,
} from '../core/git-hardening';

import type { HardenedGitCommand } from '../core/git-hardening.types';

let trustProbe: () => boolean = () => false;

/**
 * Wired once at activation to `vscode.workspace.isTrusted`. Until then, and in
 * headless runs, a workspace is untrusted, which is the safe answer.
 */
export function setGitWorkspaceTrustProbe(probe: () => boolean): void {
  trustProbe = probe;
}

function gitDirectory(start: string): string | undefined {
  let current = path.resolve(start);
  for (;;) {
    const dotGit = path.join(current, '.git');
    if (existsSync(dotGit)) {
      if (statSync(dotGit).isDirectory()) return dotGit;
      const pointer = /^gitdir:\s*(.+)$/mu.exec(readFileSync(dotGit, 'utf8'))?.[1]?.trim();
      return pointer === undefined ? undefined : path.resolve(current, pointer);
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function readConfig(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** The repo-local config files git would read for a checkout at `cwd`. */
function repositoryConfigs(cwd: string): string[] {
  const directory = gitDirectory(cwd);
  if (directory === undefined) return [];
  const common = readConfig(path.join(directory, 'commondir')).trim();
  const shared = common.length === 0 ? directory : path.resolve(directory, common);
  return [path.join(shared, 'config'), path.join(directory, 'config.worktree')];
}

/**
 * Refuses a read in an untrusted workspace whose own git config names a program
 * git would run and that a command-line override cannot pin.
 */
export function assertRepositoryConfigSafe(cwd: string, trusted: boolean = trustProbe()): void {
  if (trusted) return;
  const keys = repositoryConfigs(cwd).flatMap((file) =>
    programSpawningConfigKeys(readConfig(file)),
  );
  if (keys.length === 0) return;
  throw new Error(
    `Git was not run: this untrusted workspace's git config sets ${[...new Set(keys)].join(', ')}, ` +
      'which would run a program from the repository. Trust the workspace to allow it.',
  );
}

/**
 * Every spawn of git in this extension goes through here (or through
 * `runCommandSpec` / `runBoundedCommand`, which call it). Non-git executables
 * pass through unchanged.
 */
export function prepareGitSpawn(
  executable: string,
  args: readonly string[],
  cwd: string,
  base: Readonly<Record<string, string | undefined>>,
): HardenedGitCommand {
  if (!isGitExecutable(executable)) {
    const environment: Record<string, string> = {};
    for (const [key, value] of Object.entries(base))
      if (value !== undefined) environment[key] = value;
    return { arguments: [...args], environment };
  }
  assertRepositoryConfigSafe(cwd);
  return {
    arguments: hardenedGitArguments(args, os.devNull),
    environment: hardenedGitEnvironment(base),
  };
}

/**
 * Prepares a git write the caller explicitly granted: hooks run, program-naming
 * config stays pinned. Refuses outright unless the workspace is trusted, because
 * a write with hooks enabled runs whatever the repository's hooks contain.
 * Headless callers pass `true`: granting `git-write` is the trust decision.
 */
export function prepareTrustedGitWriteSpawn(
  args: readonly string[],
  base: Readonly<Record<string, string | undefined>>,
  trusted: boolean,
): HardenedGitCommand {
  if (!trusted) {
    throw new Error('Git write operations run repository hooks and need a trusted workspace.');
  }
  return {
    arguments: hardenedGitWriteArguments(args),
    environment: hardenedGitEnvironment(base),
  };
}
