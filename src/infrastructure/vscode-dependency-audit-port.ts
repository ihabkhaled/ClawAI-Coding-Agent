import path from 'node:path';

import * as vscode from 'vscode';

import {
  DEPENDENCY_AUDIT_OUTPUT_BYTES,
  DEPENDENCY_AUDIT_TIMEOUT_MS,
  DEPENDENCY_MANIFESTS,
} from '../core/dependency-audit.constants';
import { isSafeRelativeWorkspacePath } from '../core/workspace-path-policy';

import { resolveExecutable, runCommandSpec } from './bounded-command-runner';

import type {
  DependencyAuditOutput,
  DependencyAuditPort,
} from './dependency-audit-tool-executor.types';
import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type { DependencyAuditCommand } from '../core/dependency-audit.types';
import type { Finding } from '../core/findings';
import type { FindingsService } from '../services/findings-service';

const ROOT_KEY = 'workspace-1';

/**
 * Runs a dependency scanner at the first workspace root.
 *
 * Through `runCommandSpec`, so the scanner gets the same allowlisted
 * environment, PATH-snapshot lookup, timeout, output cap and redaction every
 * other process gets. Findings go through `FindingsService.record`, the path a
 * reviewer's own report takes, so they appear in the findings view beside it.
 */
export class VscodeDependencyAuditPort implements DependencyAuditPort {
  constructor(
    private readonly files: VscodeFileTransactionAdapter,
    private readonly findings: FindingsService,
  ) {}

  async manifests(): Promise<ReadonlySet<string>> {
    const root = this.files.workspaceRootUri(ROOT_KEY);
    const present = new Set<string>();
    for (const name of DEPENDENCY_MANIFESTS) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, name));
        present.add(name);
      } catch {
        // Absent is the ordinary answer for most of these.
      }
    }
    return present;
  }

  async available(executable: string): Promise<boolean> {
    try {
      await resolveExecutable(executable);
      return true;
    } catch {
      return false;
    }
  }

  async run(command: DependencyAuditCommand, signal?: AbortSignal): Promise<DependencyAuditOutput> {
    const root = this.files.workspaceRootUri(ROOT_KEY);
    const result = await runCommandSpec(
      {
        executable: command.executable,
        arguments: [...command.arguments],
        cwdRootKey: ROOT_KEY,
        cwd: '.',
        environment: {},
        timeoutMs: DEPENDENCY_AUDIT_TIMEOUT_MS,
        outputLimitBytes: DEPENDENCY_AUDIT_OUTPUT_BYTES,
        expectedEffect: 'network',
        targetId: 'target:workspace',
        elevation: false,
      },
      root.fsPath,
      signal,
    );
    return { stdout: result.stdout, timedOut: result.timedOut, truncated: result.truncated };
  }

  relativize(absolute: string): string | undefined {
    const root = this.files.workspaceRootUri(ROOT_KEY).fsPath;
    const relative = path.relative(root, absolute).replaceAll('\\', '/');
    return relative.length > 0 && isSafeRelativeWorkspacePath(relative) ? relative : undefined;
  }

  record(findings: readonly Finding[]): number {
    return this.findings.record(findings).findings.length;
  }
}
