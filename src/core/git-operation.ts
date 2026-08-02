import { z } from 'zod';

import { isSafeRelativeWorkspacePath } from './workspace-path-policy';

const safeRef = z
  .string()
  .min(1)
  .max(500)
  .regex(/^(?!-)(?!.*(?:\.\.|@\{|[~^:?*[\\]))[^\s]+$/u);
const safePath = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => !value.startsWith('-') && isSafeRelativeWorkspacePath(value));
const base = { rootKey: z.string().min(1).max(100) };

export const gitOperationSchema = z.discriminatedUnion('operation', [
  z
    .object({
      ...base,
      operation: z.enum([
        'status',
        'diff',
        'log',
        'blame',
        'branches',
        'tags',
        'remotes',
        'worktrees',
        'conflicts',
        'submodules',
        'topology',
      ]),
      path: safePath.optional(),
      ref: safeRef.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.literal('create-branch'),
      branch: safeRef,
      startPoint: safeRef.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.literal('create-worktree'),
      path: safePath,
      branch: safeRef,
      startPoint: safeRef.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.enum(['stage', 'unstage']),
      paths: z.array(safePath).min(1).max(10_000),
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.literal('commit'),
      message: z.string().trim().min(1).max(10_000),
      amend: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.literal('stash'),
      message: z.string().max(500).optional(),
      includeUntracked: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.enum(['merge', 'rebase', 'cherry-pick', 'revert']),
      ref: safeRef,
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.literal('fetch'),
      remote: safeRef.default('origin'),
      ref: safeRef.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.literal('pull'),
      remote: safeRef.default('origin'),
      branch: safeRef,
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.literal('push'),
      remote: safeRef.default('origin'),
      refspec: safeRef,
      forceWithLease: z
        .object({ ref: safeRef, expectedSha: z.string().regex(/^[a-f0-9]{40,64}$/u) })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.literal('tag'),
      name: safeRef,
      target: safeRef.optional(),
      message: z.string().max(2_000).optional(),
    })
    .strict(),
]);

export type GitOperation = z.infer<typeof gitOperationSchema>;

export interface GitReceipt {
  readonly operation: GitOperation['operation'];
  readonly beforeHead: string | null;
  readonly afterHead: string | null;
  readonly beforeWorkingTreeHash: string;
  readonly afterWorkingTreeHash: string;
  readonly stagedDiffHash?: string;
  readonly pushedRef?: string;
  readonly output: string;
}
