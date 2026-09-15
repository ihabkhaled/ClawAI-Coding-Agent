import * as vscode from 'vscode';

import {
  subAgentDefinitionsFileSchema,
  type SubAgentDefinition,
} from '../core/sub-agent-definitions';

const MAX_SUB_AGENT_DEFINITIONS_BYTES = 256_000;

/**
 * Loads named sub-agent presets from `.clawai/agents/agents.json`.
 *
 * Mirrors `ProjectPolicyService`: an absent file means no presets, not an
 * error, since the file — like `policies/policy.json` — is opt-in and not
 * created by **ClawAI: Initialize .clawai**. Takes the selected root's
 * filesystem path rather than a `WorkspaceScopeService`, matching how
 * `assembleSubAgents` already resolves the same root for the worktree
 * adapter, through `RuntimeRootRegistry.workspaceRootUri` — one dependency,
 * not two.
 */
export class SubAgentDefinitionsService {
  constructor(private readonly selectedRootFsPath: () => string) {}

  async load(): Promise<readonly SubAgentDefinition[]> {
    const root = vscode.Uri.file(this.selectedRootFsPath());
    const uri = vscode.Uri.joinPath(root, '.clawai', 'agents', 'agents.json');
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch (error: unknown) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return [];
      }
      throw error;
    }
    if (bytes.byteLength > MAX_SUB_AGENT_DEFINITIONS_BYTES) {
      throw new Error(vscode.l10n.t('The workspace sub-agent definitions file is too large.'));
    }
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const candidate: unknown = JSON.parse(decoded);
    return subAgentDefinitionsFileSchema.parse(candidate);
  }
}
