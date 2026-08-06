import { createHash } from 'node:crypto';

import type { WorkspaceScopeCandidate, WorkspaceScopeSnapshot } from './workspace-scope.types';

export function workspaceFolderKey(uri: string): string {
  return createHash('sha256').update(uri).digest('hex').slice(0, 20);
}

/**
 * The `rootKey` a runtime target advertises for its Nth workspace folder.
 *
 * This convention used to be written out at the point the capability manifest
 * was built, while the filesystem adapter resolved roots only by
 * `workspaceFolderKey` — the SHA-256 form. The two never agreed, so every
 * `workspace.files` invocation failed with "The requested filesystem root is
 * not approved" even when the model faithfully used the advertised key. Both
 * sides now derive the convention from here so they cannot drift apart again.
 */
const WORKSPACE_ROOT_KEY_PREFIX = 'workspace-';

export function advertisedWorkspaceRootKey(index: number): string {
  return `${WORKSPACE_ROOT_KEY_PREFIX}${String(index + 1)}`;
}

/**
 * Resolves an advertised root key back to its folder index, or undefined when
 * the key is not one of ours. Strict on purpose: only `workspace-<n>` with a
 * positive integer, so a near-miss like `workspace` or `workspace-01` is
 * rejected rather than silently resolved to the first folder.
 */
export function advertisedWorkspaceRootIndex(rootKey: string): number | undefined {
  if (!rootKey.startsWith(WORKSPACE_ROOT_KEY_PREFIX)) return undefined;
  const ordinal = rootKey.slice(WORKSPACE_ROOT_KEY_PREFIX.length);
  if (!/^[1-9][0-9]*$/u.test(ordinal)) return undefined;
  return Number(ordinal) - 1;
}

export function requireWorkspaceScopeCandidate(
  candidates: WorkspaceScopeCandidate[],
  key: string,
): WorkspaceScopeCandidate {
  const candidate = candidates.find((entry) => workspaceFolderKey(entry.uri) === key);
  if (candidate === undefined) {
    throw new Error('The selected workspace folder is no longer available.');
  }
  return candidate;
}

export function buildWorkspaceScope(
  candidates: WorkspaceScopeCandidate[],
  selectedKey: string | undefined,
  activeFolderUri: string | undefined,
): WorkspaceScopeSnapshot {
  const folders = candidates.map((candidate) => ({
    key: workspaceFolderKey(candidate.uri),
    name: candidate.name,
  }));
  const retained = folders.find((folder) => folder.key === selectedKey);
  const active = candidates.find((candidate) => candidate.uri === activeFolderUri);
  const selected =
    retained ??
    (active === undefined
      ? folders[0]
      : folders.find((folder) => folder.key === workspaceFolderKey(active.uri)));

  return {
    folders,
    ...(selected === undefined
      ? {}
      : {
          selectedFolderKey: selected.key,
          selectedFolderName: selected.name,
        }),
  };
}
