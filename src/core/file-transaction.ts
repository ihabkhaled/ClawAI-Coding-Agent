import { createHash } from 'node:crypto';

import { z } from 'zod';

import { isSafeRelativeWorkspacePath } from './workspace-path-policy';

const pathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(isSafeRelativeWorkspacePath, 'Path must remain inside an approved root');
const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const textWriteSchema = z
  .object({
    kind: z.enum(['create', 'update']),
    path: pathSchema,
    rootKey: z.string().min(1).max(100),
    content: z.string().max(16_777_216),
    beforeHash: hashSchema.nullable(),
  })
  .strict();
const exactPatchSchema = z
  .object({
    kind: z.literal('patch'),
    path: pathSchema,
    rootKey: z.string().min(1).max(100),
    beforeHash: hashSchema,
    hunks: z
      .array(
        z
          .object({ before: z.string().min(1).max(1_048_576), after: z.string().max(1_048_576) })
          .strict(),
      )
      .min(1)
      .max(1_000),
  })
  .strict();
const renameSchema = z
  .object({
    kind: z.literal('rename'),
    path: pathSchema,
    destination: pathSchema,
    rootKey: z.string().min(1).max(100),
    beforeHash: hashSchema,
  })
  .strict();
const copySchema = z
  .object({
    kind: z.literal('copy'),
    path: pathSchema,
    destination: pathSchema,
    rootKey: z.string().min(1).max(100),
    beforeHash: hashSchema,
  })
  .strict();
const deleteSchema = z
  .object({
    kind: z.literal('delete'),
    path: pathSchema,
    rootKey: z.string().min(1).max(100),
    beforeHash: hashSchema,
  })
  .strict();
const mkdirSchema = z
  .object({
    kind: z.literal('mkdir'),
    path: pathSchema,
    rootKey: z.string().min(1).max(100),
  })
  .strict();
const binaryWriteSchema = z
  .object({
    kind: z.literal('artifact'),
    path: pathSchema,
    rootKey: z.string().min(1).max(100),
    mimeType: z.string().min(3).max(200),
    sizeBytes: z.number().int().nonnegative().max(268_435_456),
    contentHash: hashSchema,
    provenance: z.string().min(1).max(2_000),
    contentBase64: z.string().max(357_913_944),
  })
  .strict();

export const fileTransactionOperationSchema = z.discriminatedUnion('kind', [
  textWriteSchema,
  exactPatchSchema,
  renameSchema,
  copySchema,
  deleteSchema,
  mkdirSchema,
  binaryWriteSchema,
]);
export const fileTransactionSchema = z
  .object({
    transactionId: z.string().min(8).max(200),
    summary: z.string().trim().min(1).max(2_000),
    operations: z.array(fileTransactionOperationSchema).min(1).max(10_000),
  })
  .strict();

export type FileTransaction = z.infer<typeof fileTransactionSchema>;
export type FileTransactionOperation = z.infer<typeof fileTransactionOperationSchema>;

export const contentHash = (content: Uint8Array | string): string =>
  `sha256:${createHash('sha256').update(content).digest('hex')}`;

export function applyExactHunks(
  content: string,
  hunks: readonly { before: string; after: string }[],
): string {
  let output = content;
  for (const hunk of hunks) {
    const first = output.indexOf(hunk.before);
    if (first < 0 || output.includes(hunk.before, first + hunk.before.length))
      throw new Error('Exact patch context is missing or ambiguous');
    output = `${output.slice(0, first)}${hunk.after}${output.slice(first + hunk.before.length)}`;
  }
  return output;
}

export interface TouchedFileReceipt {
  readonly rootKey: string;
  readonly path: string;
  readonly operation: FileTransactionOperation['kind'];
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
}

export interface FileTransactionReceipt {
  readonly transactionId: string;
  readonly status: 'applied' | 'rolled-back' | 'failed';
  readonly touched: readonly TouchedFileReceipt[];
  readonly resumableCursor: number;
}
