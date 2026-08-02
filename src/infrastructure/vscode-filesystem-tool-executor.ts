import * as vscode from 'vscode';
import { z } from 'zod';

import { fileTransactionSchema } from '../core/file-transaction';
import { isSafeRelativeWorkspacePath } from '../core/workspace-path-policy';

import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { FileTransactionService } from '../services/file-transaction-service';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

const relativePath = z.string().max(4_096).refine(isSafeRelativeWorkspacePath);
const rootKey = z.string().min(1).max(100);
const readSchema = z
  .object({
    rootKey,
    path: relativePath,
    startLine: z.number().int().min(1).default(1),
    endLine: z.number().int().min(1).max(100_000).optional(),
    maxBytes: z.number().int().min(1).max(1_048_576).default(262_144),
  })
  .strict();
const pathSchema = z.object({ rootKey, path: relativePath }).strict();
const listSchema = z
  .object({
    rootKey,
    path: relativePath,
    cursor: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(1_000).default(200),
  })
  .strict();
const globSchema = z
  .object({
    rootKey,
    pattern: z.string().min(1).max(1_000),
    maxResults: z.number().int().min(1).max(10_000).default(1_000),
  })
  .strict();

export const workspaceFilesystemToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.files',
  version: '2.0.0',
  description: 'Bounded workspace discovery, reads, and transactional file mutation.',
  operations: [
    'stat',
    'list',
    'glob',
    'search',
    'read',
    'binary-metadata',
    'create',
    'update',
    'patch',
    'rename',
    'copy',
    'delete',
    'mkdir',
    'artifact',
  ],
  riskClasses: ['inspect', 'workspace-write', 'external-write', 'destructive'],
  targetIds: ['target:workspace'],
  inputSchema: { type: 'object', additionalProperties: true },
};

export class VscodeFilesystemToolExecutor implements RuntimeToolExecutorPort {
  constructor(
    private readonly adapter: VscodeFileTransactionAdapter,
    private readonly transactions: FileTransactionService,
  ) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== workspaceFilesystemToolDefinition.name)
      throw new Error('Unknown filesystem tool');
    signal?.throwIfAborted();
    if (invocation.operation === 'read') return this.read(invocation.arguments);
    if (invocation.operation === 'stat' || invocation.operation === 'binary-metadata')
      return this.stat(invocation.arguments);
    if (invocation.operation === 'list') return this.list(invocation.arguments);
    if (invocation.operation === 'glob') return this.glob(invocation.arguments);
    if (invocation.operation === 'search') return this.search(invocation.arguments, signal);
    const transaction = fileTransactionSchema.parse(invocation.arguments.transaction);
    if (
      transaction.operations.length !== 1 ||
      transaction.operations[0]?.kind !== invocation.operation
    )
      throw new Error('Filesystem mutation must contain exactly the requested operation');
    const preview = await this.transactions.preview(transaction, signal);
    const receipt = await this.transactions.apply(preview, signal);
    return { structured: { receipt } };
  }

  private async read(candidate: unknown): Promise<RuntimeToolExecutionOutput> {
    const input = readSchema.parse(candidate);
    const operation = {
      kind: 'update' as const,
      rootKey: input.rootKey,
      path: input.path,
      content: '',
      beforeHash: null,
    };
    const snapshot = await this.adapter.snapshot(operation);
    if (snapshot.text === undefined) throw new Error('Requested file is not readable text');
    const lines = snapshot.text.split(/\r?\n/u);
    const end = Math.min(input.endLine ?? lines.length, lines.length);
    const selected = lines.slice(input.startLine - 1, end).join('\n');
    const bytes = new TextEncoder().encode(selected);
    const bounded =
      bytes.byteLength <= input.maxBytes
        ? selected
        : new TextDecoder().decode(bytes.slice(0, input.maxBytes));
    return {
      structured: {
        path: input.path,
        startLine: input.startLine,
        endLine: end,
        content: bounded,
        truncated: bounded.length !== selected.length,
        hash: snapshot.hash,
      },
    };
  }

  private async stat(candidate: unknown): Promise<RuntimeToolExecutionOutput> {
    const input = pathSchema.parse(candidate);
    const operation = {
      kind: 'update' as const,
      rootKey: input.rootKey,
      path: input.path,
      content: '',
      beforeHash: null,
    };
    const snapshot = await this.adapter.snapshot(operation);
    return {
      structured: {
        path: input.path,
        kind: snapshot.kind,
        hash: snapshot.hash,
        sizeBytes: snapshot.bytes?.byteLength ?? 0,
        binary: snapshot.kind === 'file' && snapshot.text === undefined,
      },
    };
  }

  private async list(candidate: unknown): Promise<RuntimeToolExecutionOutput> {
    const input = listSchema.parse(candidate);
    const uri = await this.adapter.uriFor(input.rootKey, input.path);
    const entries = await vscode.workspace.fs.readDirectory(uri);
    const page = entries.slice(input.cursor, input.cursor + input.limit);
    return {
      structured: {
        entries: page.map(([name, type]) => ({ name, type })),
        nextCursor: input.cursor + page.length < entries.length ? input.cursor + page.length : null,
        total: entries.length,
      },
    };
  }

  private async glob(candidate: unknown): Promise<RuntimeToolExecutionOutput> {
    const input = globSchema.parse(candidate);
    const root = this.adapter.rootUri(input.rootKey);
    const matches = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, input.pattern),
      undefined,
      input.maxResults,
    );
    return {
      structured: {
        paths: matches.map((uri) => vscode.workspace.asRelativePath(uri, false)),
        truncated: matches.length === input.maxResults,
      },
    };
  }

  private async search(
    candidate: unknown,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    const input = globSchema.extend({ query: z.string().min(1).max(10_000) }).parse(candidate);
    const root = this.adapter.rootUri(input.rootKey);
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, input.pattern),
      undefined,
      input.maxResults,
    );
    const results: { path: string; line: number; preview: string }[] = [];
    for (const uri of files) {
      signal?.throwIfAborted();
      if (results.length >= input.maxResults) break;
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(
          await vscode.workspace.fs.readFile(uri),
        );
      } catch {
        continue;
      }
      for (const [index, line] of text.split(/\r?\n/u).entries()) {
        if (line.includes(input.query))
          results.push({
            path: vscode.workspace.asRelativePath(uri, false),
            line: index + 1,
            preview: line.slice(0, 500),
          });
        if (results.length >= input.maxResults) break;
      }
    }
    return { structured: { results, truncated: results.length >= input.maxResults } };
  }
}
