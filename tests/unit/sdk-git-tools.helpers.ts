import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { executeWorkspaceTool } from '../../src/sdk/workspace-tool-executor';

const created: string[] = [];

/** Removes every directory a test made. Call from `afterEach`. */
export function cleanUpRepositories(): void {
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(directory);
  return directory;
}

/** Runs real git in `cwd` for test set-up and assertions, returning trimmed stdout. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

function configure(repository: string): void {
  git(repository, 'config', 'user.name', 'Test Agent');
  git(repository, 'config', 'user.email', 'agent@example.com');
  git(repository, 'config', 'commit.gpgsign', 'false');
  git(repository, 'config', 'core.autocrlf', 'false');
}

/** A real repository on branch `main` with one commit. */
export function makeRepository(): string {
  const container = temporaryDirectory('claw-git-tools-');
  const repository = path.join(container, 'repo');
  mkdirSync(repository);
  git(repository, 'init', '--quiet', '-b', 'main');
  configure(repository);
  writeFileSync(path.join(repository, 'seed.txt'), 'seed\n');
  git(repository, 'add', 'seed.txt');
  git(repository, 'commit', '--quiet', '-m', 'seed');
  return repository;
}

/** A bare repository, and a working repository whose `origin` it is, already pushed. */
export function makeRepositoryWithRemote(): { work: string; bare: string } {
  const bare = temporaryDirectory('claw-git-bare-');
  git(bare, 'init', '--quiet', '--bare', '-b', 'main');
  const work = makeRepository();
  git(work, 'remote', 'add', 'origin', bare);
  git(work, 'push', '--quiet', 'origin', 'main');
  git(work, 'branch', '--set-upstream-to=origin/main', 'main');
  return { work, bare };
}

/** A second working copy of `bare`, standing in for a colleague. */
export function cloneOf(bare: string): string {
  const parent = temporaryDirectory('claw-git-clone-');
  const clone = path.join(parent, 'clone');
  git(parent, 'clone', '--quiet', bare, clone);
  configure(clone);
  return clone;
}

/** Installs a `sh` hook that runs `body`. */
export function installHook(repository: string, name: string, body: string): void {
  const directory = path.join(repository, '.git', 'hooks');
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

/** Runs one `workspace.git` call the way the toolkit does, and returns the JSON object. */
export async function gitCall(
  workspace: string,
  operation: string,
  args: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const result: unknown = await executeWorkspaceTool(
    { toolName: 'workspace.git', operation, arguments: args },
    { workspace, allowedExecutables: [] },
    signal,
  );
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new Error('workspace.git did not return an object');
  }
  return Object.fromEntries(Object.entries(result));
}

/** Writes a file inside the repository. */
export function writeIn(repository: string, name: string, content: string): void {
  const target = path.join(repository, name);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}
