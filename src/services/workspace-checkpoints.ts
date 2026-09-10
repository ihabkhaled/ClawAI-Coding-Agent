import { randomUUID } from 'node:crypto';

import { VscodeNotebookReader } from '../infrastructure/vscode-notebook-reader';

import { CheckpointStore } from './checkpoint-store';

import type { CheckpointDependencies } from './checkpoint-command.types';
import type { CheckpointStoragePort } from './checkpoint-store.types';
import type { FileTransactionService } from './file-transaction-service';
import type { Checkpoint, CheckpointFile } from '../core/checkpoint.types';
import type { Uri } from 'vscode';

/**
 * Binds checkpoints to the workspace they describe.
 *
 * Reading uses the same root-addressed reader the notebook tool uses, so a
 * checkpoint captures the file the agent actually wrote rather than whatever
 * an editor happens to have open and unsaved.
 *
 * A file that has since been deleted is skipped rather than failing the whole
 * checkpoint: the other files are still worth remembering, and a checkpoint
 * that refuses to exist because one file went away is a checkpoint nobody
 * gets.
 */
export function workspaceCheckpoints(
  studio: { transactions: FileTransactionService; files: { workspaceRootUri(key: string): Uri } },
  storage: CheckpointStoragePort,
): CheckpointDependencies {
  const transactions = studio.transactions;
  const reader = new VscodeNotebookReader((key) => studio.files.workspaceRootUri(key));
  const store = new CheckpointStore(storage);
  return {
    touchedFiles: async () => {
      const files: CheckpointFile[] = [];
      for (const file of transactions.touchedFiles) {
        try {
          files.push({ ...file, content: await reader.read(file.rootKey, file.path) });
        } catch {
          continue;
        }
      }
      return files;
    },
    checkpoints: () => store.read(),
    save: (checkpoint) => store.add(checkpoint),
    restore: async (checkpoint: Checkpoint) => {
      const preview = await transactions.preview({
        transactionId: `checkpoint-restore:${randomUUID()}`,
        summary: `Restore checkpoint ${checkpoint.label}`,
        operations: checkpoint.files.map((file) => ({
          kind: 'update' as const,
          rootKey: file.rootKey,
          path: file.path,
          content: file.content,
          beforeHash: null,
        })),
      });
      await transactions.apply(preview);
    },
  };
}
