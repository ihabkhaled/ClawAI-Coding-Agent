import {
  autosaveTargets,
  DEFAULT_AUTOSAVE_POLICY,
  type AutosavePolicy,
} from '../core/autosave-policy';
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
  /** Saves any open, dirty document among these, and resolves when written. */
  saveIfDirty(
    targets: readonly { readonly rootKey: string; readonly path: string }[],
    signal?: AbortSignal,
  ): Promise<void>;
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

/**
 * How many applied transactions can be undone.
 *
 * Undo remembered exactly one, so a run that made three edits could take back
 * the third and no more — and the third is rarely the one a reader objects to.
 * The stack is bounded because each entry holds the before-state bytes it
 * would restore, and an unbounded history of those is an unbounded amount of
 * the workspace held in memory for a session that may never undo anything.
 */
export const MAX_UNDO_DEPTH = 20;

export class FileTransactionService {
  private readonly applied: FileTransactionPreview[] = [];
  constructor(
    private readonly adapter: FileTransactionAdapter,
    private readonly gate = new WorkspaceMutationGate(),
    private readonly autosavePolicy: () => AutosavePolicy = () => DEFAULT_AUTOSAVE_POLICY,
  ) {}

  async preview(candidate: unknown, signal?: AbortSignal): Promise<FileTransactionPreview> {
    const transaction = fileTransactionSchema.parse(candidate);
    if (!this.adapter.isTrusted()) throw new Error('Trust the workspace before reviewing changes');
    // Before the snapshot, never after. Saving a dirty buffer changes the file
    // the preview is about to hash, so a save between preview and apply would
    // trip the very drift check it is meant to resolve.
    await this.adapter.saveIfDirty(autosaveTargets(transaction, this.autosavePolicy()), signal);
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
        // Newest last, oldest dropped: an undo takes back the most recent
        // change, so the far end of the stack is the one worth forgetting.
        this.applied.push(preview);
        if (this.applied.length > MAX_UNDO_DEPTH) this.applied.shift();
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

  /**
   * Every file the agent has changed in this session, newest capture last.
   *
   * The applied stack is in application order, so a file changed three times
   * appears three times and the last entry is the one on disk.
   */
  get touchedFiles(): { rootKey: string; path: string }[] {
    return this.applied.flatMap((preview) =>
      preview.touched.map((file) => ({ rootKey: file.rootKey, path: file.path })),
    );
  }

  /** How many applied transactions could still be undone. */
  get undoDepth(): number {
    return this.applied.length;
  }

  /**
   * Cleared on a boundary: a stack entry restores bytes into a workspace that
   * is no longer the open one, which would write a stale file into a new tree.
   */
  forgetUndoHistory(): void {
    this.applied.length = 0;
  }

  async undoLast(signal?: AbortSignal): Promise<FileTransactionReceipt | undefined> {
    const operationSignal = signal ?? new AbortController().signal;
    return this.gate.runExclusive(operationSignal, async () => {
      const preview = this.applied.at(-1);
      if (preview === undefined) return undefined;
      operationSignal.throwIfAborted();
      await this.adapter.rollback(preview.transaction, preview.prepared);
      // Popped only after the rollback succeeds. A failed rollback leaves the
      // entry in place so the same undo can be retried, rather than losing the
      // only record of how to restore the file.
      this.applied.pop();
      return {
        transactionId: preview.transaction.transactionId,
        status: 'rolled-back',
        touched: preview.touched,
        resumableCursor: preview.prepared.length,
      };
    });
  }
}
