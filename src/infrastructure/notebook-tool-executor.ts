import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  applyCellEdit,
  cellText,
  parseNotebook,
  serializeNotebook,
} from '../core/notebook-document';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { FileTransactionService } from '../services/file-transaction-service';
import type { NotebookReaderPort } from '../services/notebook-tool.types';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const notebookToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.notebook',
  version: '2.0.0',
  description:
    'Read and edit Jupyter notebooks one cell at a time. read returns the cells with their ' +
    'index, type and source. insert-cell, replace-cell and delete-cell change exactly one ' +
    'cell and leave every other field of the file alone — outputs, metadata and widget state ' +
    'survive. Edits go through the same review and undo as any other file change.',
  operations: ['read', 'insert-cell', 'replace-cell', 'delete-cell'],
  riskClasses: ['inspect', 'workspace-write'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.notebook,
};

const locationSchema = z.object({
  rootKey: z.string().min(1).max(100),
  path: z.string().min(1).max(4_096),
});

const editSchema = locationSchema.extend({
  index: z.number().int().min(0).max(10_000),
  source: z.string().max(1_048_576).optional(),
  cellType: z.enum(['code', 'markdown', 'raw']).optional(),
});

/**
 * Cell-granular notebook editing.
 *
 * An `.ipynb` is JSON, so this works on the file rather than through the
 * editor's notebook API. That is deliberate: a text transaction is what the
 * approval, preview, hash-check and undo machinery already understands, so a
 * notebook edit is reviewed and reversible exactly like every other edit
 * instead of being a second, weaker path.
 */
export class NotebookToolExecutor implements RuntimeToolExecutorPort {
  constructor(
    private readonly files: FileTransactionService,
    private readonly reader: NotebookReaderPort,
  ) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== notebookToolDefinition.name)
      throw new Error('Unknown notebook tool');
    if (invocation.operation === 'read') {
      const location = locationSchema.parse(invocation.arguments);
      const parsed = parseNotebook(await this.reader.read(location.rootKey, location.path));
      return {
        structured: {
          cells: parsed.notebook.cells.map((cell, index) => ({
            index,
            cellType: cell.cell_type,
            source: cellText(cell.source),
          })),
        },
      };
    }
    const input = editSchema.parse(invocation.arguments);
    const before = await this.reader.read(input.rootKey, input.path);
    const edited = applyCellEdit(parseNotebook(before), this.editFor(invocation.operation, input));
    const preview = await this.files.preview(
      {
        transactionId: `notebook:${randomUUID()}`,
        summary: `${invocation.operation} in ${input.path}`,
        operations: [
          {
            kind: 'update',
            rootKey: input.rootKey,
            path: input.path,
            content: serializeNotebook(edited),
            beforeHash: null,
          },
        ],
      },
      signal,
    );
    return { structured: { receipt: await this.files.apply(preview, signal) } };
  }

  private editFor(
    operation: string,
    input: z.infer<typeof editSchema>,
  ): Parameters<typeof applyCellEdit>[1] {
    if (operation === 'delete-cell') return { kind: 'delete', index: input.index };
    if (input.source === undefined) throw new Error('This operation needs a cell source');
    if (operation === 'replace-cell')
      return { kind: 'replace', index: input.index, source: input.source };
    if (operation !== 'insert-cell') throw new Error('Unknown notebook operation');
    return {
      kind: 'insert',
      index: input.index,
      cellType: input.cellType ?? 'code',
      source: input.source,
    };
  }
}
