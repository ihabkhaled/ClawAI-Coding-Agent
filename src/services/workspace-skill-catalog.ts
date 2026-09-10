import { VscodeSkillSource } from '../infrastructure/vscode-skill-source';

import { SkillCatalogService } from './skill-catalog-service';

import type { WorkspaceScopeService } from './workspace-scope-service';
import type * as vscode from 'vscode';

/**
 * The skill catalog for the folder the agent is pointed at.
 *
 * The folder is read at call time rather than captured: the user can switch
 * the agent's workspace folder mid-session, and a catalog holding the folder
 * from construction would keep offering the previous project's commands.
 */
export function workspaceSkillCatalog(
  globalStorageUri: vscode.Uri,
  workspaceScope: WorkspaceScopeService,
): SkillCatalogService {
  return new SkillCatalogService(
    new VscodeSkillSource(globalStorageUri, () =>
      workspaceScope.refresh().selectedFolderKey === undefined
        ? undefined
        : workspaceScope.selectedFolder().uri,
    ),
  );
}
