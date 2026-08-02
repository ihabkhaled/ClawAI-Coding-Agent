import {
  applyExactHunks,
  contentHash,
  fileTransactionSchema,
  type FileTransaction,
  type FileTransactionOperation,
  type FileTransactionReceipt,
  type TouchedFileReceipt,
} from '../core/file-transaction';
import { WorkspaceMutationGate } from '../core/workspace-mutation-gate';

export interface FileSnapshot {
  readonly rootKey: string;
  readonly path: string;
  readonly kind: 'missing' | 'file' | 'directory';
  readonly hash: string | null;
  readonly bytes?: Uint8Array;
  readonly text?: string;
  readonly openBufferVersion?: number;
}

export interface PreparedFileOperation {
  readonly operation: FileTransactionOperation;
  readonly before: FileSnapshot;
  readonly afterBytes?: Uint8Array;
  readonly afterText?: string;
}

export interface FileTransactionAdapter {
  isTrusted(): boolean;
  snapshot(operation: FileTransactionOperation, signal?: AbortSignal): Promise<FileSnapshot>;
  apply(
    transaction: FileTransaction,
    prepared: readonly PreparedFileOperation[],
    signal?: AbortSignal,
  ): Promise<void>;
  rollback(transaction: FileTransaction, prepared: readonly PreparedFileOperation[]): Promise<void>;
}

export interface FileTransactionPreview {
  readonly transaction: FileTransaction;
  readonly prepared: readonly PreparedFileOperation[];
  readonly touched: readonly TouchedFileReceipt[];
}

const utf8 = new TextEncoder();

function expectedBeforeHash(operation: FileTransactionOperation): string | null | undefined {
  if (operation.kind === 'mkdir' || operation.kind === 'artifact') return undefined;
  return operation.beforeHash;
}

function assertPrecondition(operation: FileTransactionOperation, before: FileSnapshot): void {
  const expected = expectedBeforeHash(operation);
  if (expected === undefined) return;
  if (expected !== before.hash) throw new Error(`File changed after review: ${operation.path}`);
  if (operation.kind === 'create' && before.kind !== 'missing')
    throw new Error(`Create target already exists: ${operation.path}`);
  if (operation.kind !== 'create' && before.kind !== 'file')
    throw new Error(`File operation target is unavailable: ${operation.path}`);
}

function materialize(
  operation: FileTransactionOperation,
  before: FileSnapshot,
): Pick<PreparedFileOperation, 'afterBytes' | 'afterText'> {
  if (operation.kind === 'create' || operation.kind === 'update') {
    return { afterText: operation.content, afterBytes: utf8.encode(operation.content) };
  }
  if (operation.kind === 'patch') {
    if (before.text === undefined) throw new Error(`Patch target is not text: ${operation.path}`);
    const afterText = applyExactHunks(before.text, operation.hunks);
    return { afterText, afterBytes: utf8.encode(afterText) };
  }
  if (operation.kind === 'artifact') {
    const bytes = Uint8Array.from(Buffer.from(operation.contentBase64, 'base64'));
    if (bytes.byteLength !== operation.sizeBytes || contentHash(bytes) !== operation.contentHash)
      throw new Error(`Artifact receipt does not match its content: ${operation.path}`);
    return { afterBytes: bytes };
  }
  if (operation.kind === 'copy') {
    if (before.bytes === undefined)
      throw new Error(`Copy source is unavailable: ${operation.path}`);
    return {
      afterBytes: before.bytes,
      ...(before.text === undefined ? {} : { afterText: before.text }),
    };
  }
  return {};
}

function touchedReceipt(prepared: PreparedFileOperation): TouchedFileReceipt {
  const { operation, before, afterBytes } = prepared;
  return {
    rootKey: operation.rootKey,
    path:
      operation.kind === 'rename' || operation.kind === 'copy'
        ? operation.destination
        : operation.path,
    operation: operation.kind,
    beforeHash: before.hash,
    afterHash:
      operation.kind === 'delete'
        ? null
        : afterBytes === undefined
          ? before.hash
          : contentHash(afterBytes),
  };
}

export class FileTransactionService {
  private lastApplied: FileTransactionPreview | undefined;
  constructor(
    private readonly adapter: FileTransactionAdapter,
    private readonly gate = new WorkspaceMutationGate(),
  ) {}

  async preview(candidate: unknown, signal?: AbortSignal): Promise<FileTransactionPreview> {
    const transaction = fileTransactionSchema.parse(candidate);
    if (!this.adapter.isTrusted()) throw new Error('Trust the workspace before reviewing changes');
    const prepared: PreparedFileOperation[] = [];
    for (const operation of transaction.operations) {
      signal?.throwIfAborted();
      const before = await this.adapter.snapshot(operation, signal);
      assertPrecondition(operation, before);
      prepared.push({ operation, before, ...materialize(operation, before) });
    }
    return { transaction, prepared, touched: prepared.map(touchedReceipt) };
  }

  async apply(
    preview: FileTransactionPreview,
    signal?: AbortSignal,
  ): Promise<FileTransactionReceipt> {
    const operationSignal = signal ?? new AbortController().signal;
    return this.gate.runExclusive(operationSignal, async () => {
      if (!this.adapter.isTrusted()) throw new Error('Workspace trust changed before commit');
      for (const prepared of preview.prepared) {
        operationSignal.throwIfAborted();
        const current = await this.adapter.snapshot(prepared.operation, operationSignal);
        if (
          current.hash !== prepared.before.hash ||
          current.openBufferVersion !== prepared.before.openBufferVersion
        )
          throw new Error(`File changed after review: ${prepared.operation.path}`);
      }
      try {
        await this.adapter.apply(preview.transaction, preview.prepared, operationSignal);
        this.lastApplied = preview;
        return {
          transactionId: preview.transaction.transactionId,
          status: 'applied',
          touched: preview.touched,
          resumableCursor: preview.prepared.length,
        };
      } catch (error: unknown) {
        await this.adapter.rollback(preview.transaction, preview.prepared);
        throw error;
      }
    });
  }

  async undoLast(signal?: AbortSignal): Promise<FileTransactionReceipt | undefined> {
    const operationSignal = signal ?? new AbortController().signal;
    return this.gate.runExclusive(operationSignal, async () => {
      const preview = this.lastApplied;
      if (preview === undefined) return undefined;
      operationSignal.throwIfAborted();
      await this.adapter.rollback(preview.transaction, preview.prepared);
      this.lastApplied = undefined;
      return {
        transactionId: preview.transaction.transactionId,
        status: 'rolled-back',
        touched: preview.touched,
        resumableCursor: preview.prepared.length,
      };
    });
  }
}
