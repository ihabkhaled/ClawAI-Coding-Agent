import * as vscode from 'vscode';

import { projectPolicySchema, type ProjectPolicy } from '../core/policy-v2';

import type { WorkspaceScopeService } from './workspace-scope-service';

const MAX_PROJECT_POLICY_BYTES = 256_000;

export class ProjectPolicyService {
  constructor(private readonly workspaceScope: WorkspaceScopeService) {}

  async load(): Promise<ProjectPolicy> {
    const root = this.workspaceScope.selectedFolder().uri;
    const uri = vscode.Uri.joinPath(root, '.clawai', 'policies', 'policy.json');
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch (error: unknown) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return projectPolicySchema.parse({});
      }
      throw error;
    }
    if (bytes.byteLength > MAX_PROJECT_POLICY_BYTES) {
      throw new Error(vscode.l10n.t('The workspace policy file is too large.'));
    }
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const candidate: unknown = JSON.parse(decoded);
    return projectPolicySchema.parse(candidate);
  }
}
