import * as vscode from 'vscode';
import { z } from 'zod';

import { fileTransactionSchema } from '../core/file-transaction';
import { MAX_RUNTIME_JSON_ENTRIES } from '../core/runtime/runtime-json-value';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';
import {
  isSafeRelativeWorkspacePath,
  isSafeWorkspaceDirectoryPath,
  normalizeWorkspaceDirectoryPath,
} from '../core/workspace-path-policy';

import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { FileTransactionService } from '../services/file-transaction-service';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

// The refine used to fail with zod's bare "Invalid input", which reached the
// model as its whole explanation. A model holding a perfectly valid path was
// told the path was invalid, so it resubmitted the same path until the budget
// ran out — 38 times, in the run that surfaced this. Say what the rule is.
const relativePath = z
  .string()
  .max(4_096)
  .refine(
    isSafeRelativeWorkspacePath,
    'Path was refused by workspace policy: it must be relative to the workspace root and must not name a credential-shaped file (for example .env, passwords.txt, id_rsa)',
  );
// Enumeration is the one place the workspace root is a legitimate target, and
// the only way an agent can discover anything before it knows a subdirectory
// name. Root spellings are folded to the empty relative path here so the rest
// of the pipeline sees one canonical value.
const directoryPath = z
  .string()
  .max(4_096)
  .refine(isSafeWorkspaceDirectoryPath)
  .transform(normalizeWorkspaceDirectoryPath);
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
    path: directoryPath,
    cursor: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(MAX_RUNTIME_JSON_ENTRIES).default(MAX_RUNTIME_JSON_ENTRIES),
  })
  .strict();
const globSchema = z
  .object({
    rootKey,
    pattern: z.string().min(1).max(1_000),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(MAX_RUNTIME_JSON_ENTRIES)
      .default(MAX_RUNTIME_JSON_ENTRIES),
  })
  .strict();

export const workspaceFilesystemToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.files',
  version: '2.0.0',
  // The description is the ONLY guidance the model gets about these arguments:
  // the catalog it receives carries name, operations, targetIds and a bare
  // input shape, while the capability manifest that knows the real roots is
  // sent to the backend as a hash. Without the convention spelled out here a
  // model has to guess `rootKey`, and the natural guesses — "workspace",
  // "root", an absolute path — all resolve to nothing, so every single
  // invocation failed before touching the disk.
  description:
    'Bounded workspace discovery, reads, and transactional file mutation. ' +
    'Set rootKey to "workspace-1" for the first workspace folder, "workspace-2" for the second, ' +
    'and so on in the order they are opened; most workspaces have only "workspace-1". ' +
    'path is always relative to that folder and never absolute. ' +
    'To enumerate the folder itself, use the list operation with path "" — that is how to ' +
    'discover the top-level layout before any subdirectory name is known. ' +
    'List, glob, and search return at most 100 results per call. Paginate list with cursor; ' +
    'when glob or search reports truncated, narrow the pattern or query before continuing. ' +
    // Writing was undiscoverable: every mutation goes through a nested
    // transaction whose shape the catalog reports as an empty object, so a
    // model had to guess it and no model ever did. Spelling it out here is the
    // only channel that reaches the model, exactly as with rootKey.
    'To WRITE a file, put a transaction in arguments: ' +
    '{"transaction":{"transactionId":"<unique id>","summary":"<what and why>",' +
    '"operations":[{"kind":"create","rootKey":"workspace-1","path":"<relative path>",' +
    '"content":"<full file text>","beforeHash":null}]}}. ' +
    'Use kind "create" for a new file and "update" to replace an existing one, where beforeHash ' +
    'is the "sha256:<hex>" the read operation reported for the current bytes — null only when ' +
    'creating. Send exactly one operation per call and make its kind match the operation you ' +
    'requested.',
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
  inputSchema: runtimeToolInputSchemas.files,
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
    const boundedMatches = matches.slice(0, input.maxResults);
    return {
      structured: {
        paths: boundedMatches.map((uri) => vscode.workspace.asRelativePath(uri, false)),
        truncated: matches.length >= input.maxResults,
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
    const candidateSetTruncated = files.length >= input.maxResults;
    const results: { path: string; line: number; preview: string }[] = [];
    for (const uri of files.slice(0, input.maxResults)) {
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
    return {
      structured: {
        results,
        truncated: candidateSetTruncated || results.length >= input.maxResults,
      },
    };
  }
}
