import * as vscode from 'vscode';

import type { SarifImportPort } from './sarif-import-tool-executor.types';
import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type { Finding } from '../core/findings';
import type { FindingsService } from '../services/findings-service';

/**
 * Reads a scanner's report from the workspace and records what it found.
 *
 * The report is resolved through the same root the other tools use, so a scan
 * cannot import a file the run may not read. Imported results go through
 * `FindingsService.record`, which is the same path a reviewer's own report
 * takes: duplicates collapse, severity conflicts resolve upward, and a scanner
 * result and a human finding about the same line become one entry rather than
 * two competing ones.
 */
export class VscodeSarifPort implements SarifImportPort {
  constructor(
    private readonly files: VscodeFileTransactionAdapter,
    private readonly findings: FindingsService,
  ) {}

  async readReport(path: string): Promise<string | undefined> {
    try {
      const uri = vscode.Uri.joinPath(this.files.workspaceRootUri('workspace-1'), path);
      const bytes = await vscode.workspace.fs.readFile(uri);
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      // Missing, binary, a directory, or outside the root. All of them mean the
      // caller named something that is not a report, which is one mistake.
      return undefined;
    }
  }

  record(findings: readonly Finding[]): Promise<number> {
    return Promise.resolve(this.findings.record(findings).findings.length);
  }
}
