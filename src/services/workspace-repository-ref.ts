import * as vscode from 'vscode';

import { repositoryRefOf } from '../core/repository-ref';
import { workspaceGitFacts } from '../infrastructure/workspace-git-facts';

import type { RepositoryRef } from '../core/repository-ref.types';

/**
 * F095: the credential-free repository reference for the open workspace, or
 * undefined when no folder has a git remote. With several folders, one whose
 * name matches `preferredNames` (a runner's repositories) wins, then the first
 * folder that has a remote.
 */
export function workspaceRepositoryRef(
  preferredNames: readonly string[] = [],
): RepositoryRef | undefined {
  const preferred = new Set(preferredNames.map((name) => name.toLowerCase()));
  const refs = (vscode.workspace.workspaceFolders ?? []).flatMap((folder) => {
    const facts = workspaceGitFacts(folder.uri.fsPath);
    const ref = facts === undefined ? undefined : repositoryRefOf(facts);
    return ref === undefined ? [] : [ref];
  });
  return refs.find((ref) => preferred.has(ref.name.toLowerCase())) ?? refs[0];
}
