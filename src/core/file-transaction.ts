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

/**
 * Rewrites a hunk to the line ending the document actually uses.
 *
 * The read operation normalises a file to `\n` before the model ever sees it,
 * so a model looking at a CRLF checkout is shown LF and faithfully echoes LF
 * back in its hunk. Matching that against the raw bytes could never succeed:
 * on a Windows checkout every `patch` failed with "Exact patch context is
 * missing or ambiguous", which reads like the model got the context wrong when
 * the context was exactly right. A live mission lost several attempts to it and
 * fell back to rewriting whole files.
 *
 * Converting rather than accepting either form keeps the file's own convention:
 * splicing LF into a CRLF document would leave mixed endings behind.
 */
function toDocumentNewlines(text: string, documentUsesCrlf: boolean): string {
  const normalized = text.replaceAll('\r\n', '\n');
  return documentUsesCrlf ? normalized.replaceAll('\n', '\r\n') : normalized;
}

export function applyExactHunks(
  content: string,
  hunks: readonly { before: string; after: string }[],
): string {
  const documentUsesCrlf = content.includes('\r\n');
  let output = content;
  for (const hunk of hunks) {
    // The hunk as the document would have written it, falling back to exactly
    // what was sent so a mixed-ending file can still be matched literally.
    const converted = toDocumentNewlines(hunk.before, documentUsesCrlf);
    const before = output.includes(converted) ? converted : hunk.before;
    const after =
      before === converted ? toDocumentNewlines(hunk.after, documentUsesCrlf) : hunk.after;
    const first = output.indexOf(before);
    if (first < 0 || output.includes(before, first + before.length))
      throw new Error('Exact patch context is missing or ambiguous');
    output = `${output.slice(0, first)}${after}${output.slice(first + before.length)}`;
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
