import { z } from 'zod';

import type { NotebookCellEdit, ParsedNotebook } from './notebook-document.types';

/** A cell's source is a string or an array of lines, and both are common. */
const cellSourceSchema = z.union([z.string(), z.array(z.string())]);

/**
 * Only the fields cell editing needs are described.
 *
 * `.passthrough()` is the whole point: an `.ipynb` carries outputs, execution
 * counts, per-cell metadata and widget state that no editor should have an
 * opinion about. Parsing into a narrow shape and writing it back is exactly
 * how a notebook gets destroyed by a tool that meant well.
 */
const notebookCellSchema = z.object({ cell_type: z.string(), source: cellSourceSchema }).loose();

const notebookSchema = z.object({ cells: z.array(notebookCellSchema) }).loose();

/** How many cells a notebook may have before this refuses to work on it. */
export const MAX_NOTEBOOK_CELLS = 5_000;

/**
 * Reads a notebook, keeping every field it does not understand.
 *
 * Indentation is remembered so the file is written back the way it was found.
 * A notebook reformatted from two spaces to four is a diff nobody asked for
 * and a merge conflict for everyone else on the branch.
 */
export function parseNotebook(text: string): ParsedNotebook {
  const parsed = notebookSchema.parse(JSON.parse(text));
  if (parsed.cells.length > MAX_NOTEBOOK_CELLS) {
    throw new Error(`Notebook has more than ${String(MAX_NOTEBOOK_CELLS)} cells`);
  }
  return { notebook: parsed, indent: detectIndent(text), trailingNewline: text.endsWith('\n') };
}

function detectIndent(text: string): number {
  const match = /\n(\s+)"/u.exec(text);
  const indent = match?.[1]?.replaceAll('\t', '  ').length ?? 1;
  return indent > 0 && indent <= 8 ? indent : 1;
}

/** Writes the notebook back in the shape it was found. */
export function serializeNotebook(parsed: ParsedNotebook): string {
  const text = JSON.stringify(parsed.notebook, undefined, parsed.indent);
  return parsed.trailingNewline ? `${text}\n` : text;
}

/**
 * The source of one cell as a single string.
 *
 * nbformat stores source either way and both are valid, so reading normalizes
 * and writing preserves whichever the file already used. Changing the
 * representation of a cell nobody edited would show up in the diff.
 */
export function cellText(source: string | string[]): string {
  return Array.isArray(source) ? source.join('') : source;
}

function asSource(previous: string | string[], text: string): string | string[] {
  if (!Array.isArray(previous)) return text;
  const lines = text.split('\n');
  return lines.map((line, index) => (index === lines.length - 1 ? line : `${line}\n`));
}

/**
 * Applies one cell edit, returning a new notebook.
 *
 * An index outside the notebook is refused rather than clamped. Clamping turns
 * "edit cell 12" in a nine-cell notebook into a silent edit of cell nine,
 * which is the kind of help nobody wants from a tool holding a file.
 */
export function applyCellEdit(parsed: ParsedNotebook, edit: NotebookCellEdit): ParsedNotebook {
  const cells = [...parsed.notebook.cells];
  if (edit.kind === 'insert') {
    if (edit.index < 0 || edit.index > cells.length) throw new Error(indexError(edit.index));
    cells.splice(edit.index, 0, {
      cell_type: edit.cellType,
      source: edit.source,
      metadata: {},
      ...(edit.cellType === 'code' ? { outputs: [], execution_count: null } : {}),
    });
    return withCells(parsed, cells);
  }
  const target = cells[edit.index];
  if (target === undefined) throw new Error(indexError(edit.index));
  if (edit.kind === 'delete') {
    cells.splice(edit.index, 1);
    return withCells(parsed, cells);
  }
  // Replacing source clears the outputs with it: an output that no longer
  // corresponds to the code above it is worse than no output at all.
  cells[edit.index] = {
    ...target,
    source: asSource(target.source, edit.source),
    ...('outputs' in target ? { outputs: [], execution_count: null } : {}),
  };
  return withCells(parsed, cells);
}

function indexError(index: number): string {
  return `No cell at index ${String(index)}`;
}

function withCells(
  parsed: ParsedNotebook,
  cells: ParsedNotebook['notebook']['cells'],
): ParsedNotebook {
  return { ...parsed, notebook: { ...parsed.notebook, cells } };
}
