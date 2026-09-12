import { VscodeSkillSource } from '../infrastructure/vscode-skill-source';

import { OutputStyleCatalog } from './output-style-catalog';
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

/**
 * The output styles for the folder the agent is pointed at.
 *
 * Same directory shape as skills, one level over: `.clawai/output-styles`
 * rather than `.clawai/skills`. Both are folders of Markdown with an optional
 * header, so both are read by one source with the directory as a parameter.
 */
export function workspaceOutputStyles(
  globalStorageUri: vscode.Uri,
  workspaceScope: WorkspaceScopeService,
): OutputStyleCatalog {
  return new OutputStyleCatalog(
    new VscodeSkillSource(
      globalStorageUri,
      () =>
        workspaceScope.refresh().selectedFolderKey === undefined
          ? undefined
          : workspaceScope.selectedFolder().uri,
      'output-styles',
    ),
  );
}

/**
 * Both file-backed catalogs for the folder the agent is pointed at.
 *
 * Returned together because they are built from the same two inputs and are
 * always wanted together; two call sites doing the same thing is two places to
 * forget the folder can change.
 */
export function workspaceCatalogs(
  globalStorageUri: vscode.Uri,
  workspaceScope: WorkspaceScopeService,
): { skills: SkillCatalogService; outputStyles: OutputStyleCatalog } {
  return {
    skills: workspaceSkillCatalog(globalStorageUri, workspaceScope),
    outputStyles: workspaceOutputStyles(globalStorageUri, workspaceScope),
  };
}
