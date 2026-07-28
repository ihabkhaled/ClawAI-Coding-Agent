import { createHash } from 'node:crypto';

import type { WorkspaceScopeCandidate, WorkspaceScopeSnapshot } from './workspace-scope.types';

export function workspaceFolderKey(uri: string): string {
  return createHash('sha256').update(uri).digest('hex').slice(0, 20);
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
