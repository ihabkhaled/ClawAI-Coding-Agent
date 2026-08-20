import * as vscode from 'vscode';
import { z } from 'zod';

import { fileTransactionSchema } from '../core/file-transaction';
import { normalizeTransactionEncoding } from '../core/file-transaction-encoding';
import { MAX_RUNTIME_JSON_ENTRIES } from '../core/runtime/runtime-json-value';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';
import {
  isSafeRelativeWorkspacePath,
  isSafeWorkspaceDirectoryPath,
  normalizeWorkspaceDirectoryPath,
} from '../core/workspace-path-policy';

import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type { FileTransaction } from '../core/file-transaction';
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
/**
 * `search` is keyed by its `query`; the glob only narrows where to look.
 *
 * It used to inherit `pattern` from `globSchema` as REQUIRED, so a model that
 * asked the obvious question — search the workspace for this string — sent
 * `{rootKey, query}` and got back a raw zod "expected string, received
 * undefined" naming a `pattern` field it had no reason to know about. The
 * description had no room left to document it (39 characters under a cap whose
 * overflow kills the whole run), and a model cannot guess an argument that is
 * never mentioned. A live mission burned ten consecutive search calls on this
 * and fell back to reading files one by one.
 *
 * Defaulting to the whole workspace makes the required form the natural one.
 * `findFiles` is already bounded by `maxResults`, so the default cannot be
 * more expensive than the cap the caller already accepted.
 */
const searchSchema = globSchema.extend({
  query: z.string().min(1).max(10_000),
  pattern: z.string().min(1).max(1_000).default('**/*'),
});

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
    'Bounded workspace discovery, reads, and transactional mutation. rootKey is "workspace-1" ' +
    'for the first opened folder, then "workspace-2"; most use only "workspace-1". Paths are ' +
    'relative. List the root with path "". List/glob/search return at most 100 results; narrow ' +
    'truncated results. After one targeted search and read, act; do not rediscover unchanged files. ' +
    // Writing was undiscoverable: every mutation goes through a nested
    // transaction whose shape the catalog reports as an empty object, so a
    // model had to guess it and no model ever did. Spelling it out here is the
    // only channel that reaches the model, exactly as with rootKey.
    //
    // Documenting only create and update left the same hole for the other five
    // kinds. A live mission tried to patch a file three times — as
    // "content":"PATCH\n@@ …", as "patch":"@@ …", then as "content":"@@ …" —
    // because nothing said patch takes exact hunks rather than a unified diff.
    // Every attempt failed, and the model fell back to rewriting the whole file
    // with update, which silently deleted about forty comments it never saw.
    // Every advertised kind now carries its shape.
    // Every sentence here competes for the same 2000-character budget that both
    // sides of the wire enforce, and exceeding it fails the whole run-start
    // request with nothing naming the field. Keep additions terse.
    'WRITE arguments: {"transaction":{"transactionId":"<id>","summary":"<why>",' +
    '"operations":[<one operation>]}}. beforeHash is the read "sha256:<hex>". Use contentLines ' +
    'instead of content and beforeLines/afterLines for hunks; each array item is one line. Kinds: ' +
    'create/update {kind,rootKey,path,contentLines,beforeHash}; beforeHash is null only for create; ' +
    'update replaces the whole file. patch {kind,rootKey,path,beforeHash,hunks:' +
    '[{beforeLines,afterLines}]} is exact replacement, not a diff; before must occur exactly once. ' +
    'rename/copy add destination; delete needs beforeHash; mkdir takes path only; artifact ' +
    'adds mimeType,sizeBytes,contentHash,provenance,contentBase64. ' +
    'One small mutation per call. For source containing braces, quotes or backslashes, use ' +
    'contentBase64/beforeBase64/afterBase64 to avoid false unfinished-object detection. Never ' +
    'send two forms of one field.',
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

// Both checks below used to share one message, "must contain exactly the
// requested operation", for a wrong operation count and a mismatched kind
// alike. A model that copied the envelope's `operation` from an earlier,
// unrelated call while correctly setting the new operation's `kind` got that
// sentence back and had no way to see which of the two actually disagreed.
function assertSingleMatchingOperation(transaction: FileTransaction, operation: string): void {
  if (transaction.operations.length !== 1)
    throw new Error(
      `Filesystem mutation must contain exactly one operation, got ${String(transaction.operations.length)}`,
    );
  const kind = transaction.operations[0]?.kind ?? 'missing';
  if (kind !== operation)
    throw new Error(
      `Filesystem mutation operation "${operation}" must match transaction.operations[0].kind "${kind}"`,
    );
}

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
    const transaction = fileTransactionSchema.parse(
      normalizeTransactionEncoding(invocation.arguments.transaction),
    );
    assertSingleMatchingOperation(transaction, invocation.operation);
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
    const input = searchSchema.parse(candidate);
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
