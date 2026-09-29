import * as vscode from 'vscode';

import { savedWorkflowSchema, workflowFileName } from '../core/saved-workflow';
import { workflowTemplateSchema } from '../core/workflow-template';

import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type { WorkflowStorePort } from './workflow-store-tool-executor.types';
import type { SavedWorkflow } from '../core/saved-workflow';
import type { WorkflowTemplate } from '../core/workflow-template';
import type { ZodType } from 'zod';

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
  constructor(private readonly files: Pick<VscodeFileTransactionAdapter, 'workspaceRootUri'>) {}

  async list(): Promise<readonly SavedWorkflow[]> {
    return this.parsedFiles((uri) => this.readFile(uri));
  }

  /**
   * User-defined workflow templates from the same folder. A template file
   * fails the graph schema and a graph fails this one, so neither listing
   * can surface the other kind.
   */
  async listTemplates(): Promise<readonly WorkflowTemplate[]> {
    return this.parsedFiles((uri) => this.readJson(uri, workflowTemplateSchema));
  }

  private async parsedFiles<T>(parse: (uri: vscode.Uri) => Promise<T | undefined>): Promise<T[]> {
    const directory = this.directory();
    if (directory === undefined) return [];
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(directory);
    } catch {
      return [];
    }
    const parsed: T[] = [];
    for (const [name, kind] of entries) {
      if (kind !== vscode.FileType.File || !name.endsWith('.json')) continue;
      const entry = await parse(vscode.Uri.joinPath(directory, name));
      // A malformed file is skipped rather than failing the listing. One bad
      // workflow must not hide every good one.
      if (entry !== undefined) parsed.push(entry);
    }
    return parsed;
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

  private readFile(uri: vscode.Uri): Promise<SavedWorkflow | undefined> {
    return this.readJson(uri, savedWorkflowSchema);
  }

  private async readJson<T>(uri: vscode.Uri, schema: ZodType<T>): Promise<T | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > MAX_WORKFLOW_BYTES) return undefined;
      const parsed: unknown = JSON.parse(new TextDecoder('utf-8').decode(bytes));
      return schema.parse(parsed);
    } catch {
      return undefined;
    }
  }
}
