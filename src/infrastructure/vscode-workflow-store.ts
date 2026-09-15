import * as vscode from 'vscode';

import { savedWorkflowSchema, workflowFileName } from '../core/saved-workflow';

import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type { WorkflowStorePort } from './workflow-store-tool-executor.types';
import type { SavedWorkflow } from '../core/saved-workflow';

const WORKFLOW_DIRECTORY = 'workflows';
const MAX_WORKFLOW_BYTES = 512 * 1024;

/**
 * Saved workflows as workspace content, under `.clawai/workflows`.
 *
 * They belong in the repository rather than in extension storage because a
 * workflow describes how this project is worked on: the next person to clone it
 * should get the graph that worked, and the graph should travel with the code
 * it was written against.
 *
 * Every file is parsed through the schema on read. A file in the workspace is
 * editable by anyone, and a graph that skipped validation because it came from
 * disk would be the one path into the runtime that never checked its input.
 */
export class VscodeWorkflowStore implements WorkflowStorePort {
  constructor(private readonly files: VscodeFileTransactionAdapter) {}

  async list(): Promise<readonly SavedWorkflow[]> {
    const directory = this.directory();
    if (directory === undefined) return [];
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(directory);
    } catch {
      return [];
    }
    const workflows: SavedWorkflow[] = [];
    for (const [name, kind] of entries) {
      if (kind !== vscode.FileType.File || !name.endsWith('.json')) continue;
      const parsed = await this.readFile(vscode.Uri.joinPath(directory, name));
      // A malformed file is skipped rather than failing the listing. One bad
      // workflow must not hide every good one.
      if (parsed !== undefined) workflows.push(parsed);
    }
    return workflows;
  }

  async read(name: string): Promise<SavedWorkflow | undefined> {
    const directory = this.directory();
    if (directory === undefined) return undefined;
    return this.readFile(vscode.Uri.joinPath(directory, workflowFileName(name)));
  }

  async write(workflow: SavedWorkflow): Promise<void> {
    const directory = this.directory();
    if (directory === undefined) throw new Error('No workspace folder to save a workflow in');
    await vscode.workspace.fs.createDirectory(directory);
    const uri = vscode.Uri.joinPath(directory, workflowFileName(workflow.name));
    const body = `${JSON.stringify(workflow, null, 2)}\n`;
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(body));
  }

  private directory(): vscode.Uri | undefined {
    try {
      return vscode.Uri.joinPath(
        this.files.workspaceRootUri('workspace-1'),
        '.clawai',
        WORKFLOW_DIRECTORY,
      );
    } catch {
      return undefined;
    }
  }

  private async readFile(uri: vscode.Uri): Promise<SavedWorkflow | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > MAX_WORKFLOW_BYTES) return undefined;
      const parsed: unknown = JSON.parse(new TextDecoder('utf-8').decode(bytes));
      return savedWorkflowSchema.parse(parsed);
    } catch {
      return undefined;
    }
  }
}
