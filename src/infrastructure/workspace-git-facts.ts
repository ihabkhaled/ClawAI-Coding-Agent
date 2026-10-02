import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { RepositoryFacts } from '../core/repository-ref.types';

function read(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** The git directory of a checkout, following a worktree's `gitdir:` pointer; undefined outside one. */
function gitDirectory(folder: string): string | undefined {
  const dotGit = path.join(folder, '.git');
  if (!existsSync(dotGit)) return undefined;
  if (statSync(dotGit).isDirectory()) return dotGit;
  const pointer = /^gitdir:\s*(.+)$/mu.exec(read(dotGit))?.[1]?.trim();
  return pointer === undefined ? undefined : path.resolve(folder, pointer);
}

/** The first `url =` of `[remote "origin"]`, else of the first remote. */
function remoteUrlFrom(config: string): string | undefined {
  const sections = [...config.matchAll(/^\[remote "([^"]+)"\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/gmu)];
  const origin = sections.find((section) => section[1] === 'origin') ?? sections[0];
  return /^\s*url\s*=\s*(.+?)\s*$/mu.exec(origin?.[2] ?? '')?.[1];
}

/**
 * What a workspace folder says about its repository: the remote and the
 * current branch, read from `.git` files directly. No git program runs, so a
 * hostile repository config cannot make this read execute anything.
 */
export function workspaceGitFacts(folder: string): RepositoryFacts | undefined {
  try {
    const directory = gitDirectory(folder);
    if (directory === undefined) return undefined;
    const common = read(path.join(directory, 'commondir')).trim();
    const shared = common === '' ? directory : path.resolve(directory, common);
    const head = /^ref:\s*refs\/heads\/(.+?)\s*$/mu.exec(read(path.join(directory, 'HEAD')))?.[1];
    return {
      folderName: path.basename(folder),
      remoteUrl: remoteUrlFrom(read(path.join(shared, 'config'))),
      branch: head,
    };
  } catch {
    return undefined;
  }
}
