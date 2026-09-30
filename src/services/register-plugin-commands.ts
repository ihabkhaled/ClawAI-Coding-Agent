import * as vscode from 'vscode';

import { GIT_MARKETPLACE_DIRECTORY } from '../core/plugin-git-marketplace.constants';
import {
  effectiveMarketplaceAllowlist,
  readOrganizationMarketplaceAllowlist,
} from '../core/plugin-marketplace-policy';
import { effectiveTrustedPublishers, readTrustedPublishers } from '../core/plugin-signature-policy';
import { unzipPlugin } from '../infrastructure/plugin-archive';
import { downloadBytes } from '../infrastructure/plugin-download';
import { cloneGitMarketplace } from '../infrastructure/plugin-git-clone';
import { VscodePluginFileSystem } from '../infrastructure/vscode-plugin-file-system';

import { ConfigurationService } from './configuration-service';
import { managePlugins } from './plugin-commands';
import { signatureWarningMessage } from './plugin-failure-message';
import { browsePluginMarketplaces } from './plugin-marketplace-commands';
import { PluginMarketplaceService } from './plugin-marketplace-service';
import { ProjectPolicyService } from './project-policy-service';
import { registerPluginTree } from './register-plugin-tree';
import { workspacePluginStore } from './workspace-plugins';

import type { PluginCommandDependencies } from './plugin-commands.types';
import type { WorkspaceScopeService } from './workspace-scope-service';
import type { TrustedPublishers } from '../core/plugin-signature.types';

/**
 * The marketplace allowlist from the project policy.
 *
 * No folder means no project policy. A policy file that cannot be read refuses
 * every marketplace: a broken restriction must not read as no restriction.
 */
async function projectAllowlist(
  workspaceScope: WorkspaceScopeService,
): Promise<readonly string[] | undefined> {
  if (workspaceScope.refresh().selectedFolderKey === undefined) return undefined;
  try {
    return (await new ProjectPolicyService(workspaceScope).load()).allowedPluginMarketplaces;
  } catch {
    return [];
  }
}

/** The project policy's trusted publishers; unreadable narrows to none, as above. */
async function projectPublishers(
  workspaceScope: WorkspaceScopeService,
): Promise<TrustedPublishers | undefined> {
  if (workspaceScope.refresh().selectedFolderKey === undefined) return undefined;
  try {
    return (await new ProjectPolicyService(workspaceScope).load()).trustedPluginPublishers;
  } catch {
    return {};
  }
}

/**
 * Registers the plugin manager, the marketplace browser and the Plugins view.
 *
 * `organizationPolicy` is the managed policy's `allowedPluginMarketplaces`,
 * as it arrived; the organization's list wins over the project's.
 * `organizationPublishers` is the managed policy's `trustedPluginPublishers`.
 */
export function registerPluginCommands(
  context: vscode.ExtensionContext,
  workspaceScope: WorkspaceScopeService,
  organizationPolicy: () => unknown = () => undefined,
  configuration: ConfigurationService = new ConfigurationService(),
  organizationPublishers: () => unknown = () => undefined,
): void {
  const folder = (): vscode.Uri | undefined =>
    workspaceScope.refresh().selectedFolderKey === undefined
      ? undefined
      : workspaceScope.selectedFolder().uri;
  const store = workspacePluginStore(context.globalStorageUri, folder);
  const allowlist = async (): Promise<readonly string[] | undefined> =>
    effectiveMarketplaceAllowlist(
      readOrganizationMarketplaceAllowlist(organizationPolicy()),
      await projectAllowlist(workspaceScope),
    );
  const clones = vscode.Uri.joinPath(context.globalStorageUri, GIT_MARKETPLACE_DIRECTORY).fsPath;
  const dependencies: PluginCommandDependencies = {
    store,
    marketplace: new PluginMarketplaceService({
      store,
      files: new VscodePluginFileSystem(),
      download: (url) => downloadBytes(url),
      unzip: unzipPlugin,
      cloneGit: (location) => cloneGitMarketplace(clones, location),
      allowlist,
      signatures: async () => ({
        mode: configuration.pluginSignaturePolicy(),
        trusted: effectiveTrustedPublishers(
          readTrustedPublishers(organizationPublishers()),
          await projectPublishers(workspaceScope),
          configuration.trustedPluginPublishers(),
        ),
      }),
      onUnverified: (entry, verdict) => {
        void vscode.window.showWarningMessage(signatureWarningMessage(entry, verdict));
      },
    }),
    trusted: () => vscode.workspace.isTrusted,
    marketplaces: () => configuration.pluginMarketplaces(),
    saveMarketplaces: (sources) => configuration.savePluginMarketplaces(sources),
    allowlist,
  };
  const tree = registerPluginTree(context, dependencies);
  context.subscriptions.push(
    vscode.commands.registerCommand('clawAI.managePlugins', () =>
      managePlugins(dependencies).finally(() => {
        tree.refresh();
      }),
    ),
    vscode.commands.registerCommand('clawAI.browsePluginMarketplaces', () =>
      browsePluginMarketplaces(dependencies).finally(() => {
        tree.refresh();
      }),
    ),
  );
}
