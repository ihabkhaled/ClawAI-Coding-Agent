import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { normalizeRepositoryUrl, originUrlFromGitConfig } from '../core/repository-identity';

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Where the repository's shared config lives, following a worktree's `.git`
 * file and its `commondir` to the main repository.
 */
function gitConfigPath(root: string): string | undefined {
  const dotGit = path.join(root, '.git');
  try {
    if (statSync(dotGit).isDirectory()) return path.join(dotGit, 'config');
  } catch {
    return undefined;
  }
  const pointer = /^gitdir:\s*(.+)$/mu.exec(readText(dotGit) ?? '')?.[1]?.trim();
  if (pointer === undefined) return undefined;
  const gitDirectory = path.resolve(root, pointer);
  const common = readText(path.join(gitDirectory, 'commondir'))?.trim();
  return path.join(
    common === undefined ? gitDirectory : path.resolve(gitDirectory, common),
    'config',
  );
}

export function repositoryIdentityForRoot(root: string): string | undefined {
  const configPath = gitConfigPath(root);
  const config = configPath === undefined ? undefined : readText(configPath);
  const origin = config === undefined ? undefined : originUrlFromGitConfig(config);
  return origin === undefined ? undefined : normalizeRepositoryUrl(origin);
}

/**
 * The selected workspace's repository identity, read once per root.
 *
 * Synchronous and cached because the policy request is built synchronously
 * when a capability is consumed, and must equal the one built at evaluation.
 */
export function workspaceRepositoryReader(root: () => string): () => string | undefined {
  const cache = new Map<string, string | undefined>();
  return () => {
    const current = root();
    if (!cache.has(current)) cache.set(current, repositoryIdentityForRoot(current));
    return cache.get(current);
  };
}
