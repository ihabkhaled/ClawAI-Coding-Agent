import { z } from 'zod';

import type { Checkpoint, CheckpointFile } from './checkpoint.types';

/** How many checkpoints are kept before the oldest is dropped. */
export const MAX_CHECKPOINTS = 10;

/** How much one checkpoint may hold before it is refused. */
export const MAX_CHECKPOINT_BYTES = 4 * 1024 * 1024;

export const checkpointLabelSchema = z.string().trim().min(1).max(80);

export const checkpointFileSchema = z
  .object({
    rootKey: z.string().min(1).max(100),
    path: z.string().min(1).max(4_096),
    content: z.string(),
  })
  .strict();

export const checkpointSchema = z
  .object({
    id: z.string().min(1).max(100),
    label: checkpointLabelSchema,
    createdAt: z.number().int().nonnegative(),
    files: z.array(checkpointFileSchema).max(1_000),
  })
  .strict();

/**
 * One entry per file, keeping the newest capture of each.
 *
 * A file touched by three transactions appears three times in the undo stack;
 * a checkpoint wants its current contents once. Later entries win because the
 * stack is in application order and the last write is what is on disk.
 */
export function dedupeCheckpointFiles(files: readonly CheckpointFile[]): CheckpointFile[] {
  const byPath = new Map<string, CheckpointFile>();
  for (const file of files) byPath.set(`${file.rootKey}\u0000${file.path}`, file);
  return [...byPath.values()];
}

/** The total size of a checkpoint, which is what the cap is measured against. */
export function checkpointBytes(files: readonly CheckpointFile[]): number {
  return files.reduce((total, file) => total + file.content.length, 0);
}

/**
 * The stored list after adding one, oldest dropped first.
 *
 * Bounded because a checkpoint holds file contents and an unbounded list of
 * them is a workspace-sized leak in extension storage. Ten is enough to undo a
 * bad afternoon and few enough to stay small.
 */
export function retainCheckpoints(
  existing: readonly Checkpoint[],
  incoming: Checkpoint,
): Checkpoint[] {
  return [incoming, ...existing].slice(0, MAX_CHECKPOINTS);
}
