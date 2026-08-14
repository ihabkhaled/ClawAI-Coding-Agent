import * as vscode from 'vscode';

import { detectRuntimePrerequisites } from './vscode-runtime-target-adapter';

import type { RuntimeHostProbe } from './vscode-runtime-target.types';

/**
 * Reads the live host facts the capability manifest is derived from.
 *
 * This used to be an object literal inside `activate`, which made the manifest
 * a one-shot snapshot of the window as it existed at activation. `isTrusted` is
 * the field that made that fatal: VS Code activates the extension in an
 * untrusted window too, and `buildRuntimeCapabilityManifest` only advertises
 * the local tools — `workspace.files`, `workspace.command`, `workspace.process`,
 * `workspace.git` — when the probe says the workspace is trusted. Granting trust
 * afterwards fired `onDidGrantWorkspaceTrust`, which refreshed a context key and
 * nothing else, so the manifest kept saying the target had no capabilities for
 * the rest of the window's life.
 *
 * The model was still offered all seventeen tools, because the offered list
 * comes from the router rather than the manifest, so every single call came
 * back `Execution target does not provide the requested capability`. Observed
 * on a trusted workspace whose trust editor read "You trust this folder": the
 * agent tried `workspace.git`, then `workspace.command`, then
 * `workspace.process`, and reported that the runtime had no way to commit.
 *
 * Making this a function is the whole repair: the same facts can be re-read
 * when trust is granted or the folder set changes.
 */
export function probeRuntimeHost(
  context: vscode.ExtensionContext,
  extensionVersion: string,
): RuntimeHostProbe {
  return {
    architecture: process.arch,
    extensionKind: context.extension.extensionKind === vscode.ExtensionKind.UI ? 'ui' : 'workspace',
    extensionVersion,
    platform: process.platform,
    remoteName: vscode.env.remoteName,
    shell: vscode.env.shell,
    uiKind: vscode.env.uiKind === vscode.UIKind.Web ? 'web' : 'desktop',
    vscodeVersion: vscode.version,
    workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
      name: folder.name,
      scheme: folder.uri.scheme,
      uri: folder.uri.toString(),
    })),
    workspaceTrusted: vscode.workspace.isTrusted,
    prerequisites: detectRuntimePrerequisites(context.extensionUri.fsPath),
  };
}
