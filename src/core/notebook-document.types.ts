/** A notebook parsed for editing, with everything unknown preserved. */
/** One cell, with every field the file carried that editing does not model. */
export type NotebookCell = { cell_type: string; source: string | string[] } & Record<
  string,
  unknown
>;

export interface ParsedNotebook {
  notebook: { cells: NotebookCell[] } & Record<string, unknown>;
  /** The indentation the file used, so it is written back the same way. */
  indent: number;
  trailingNewline: boolean;
}

/** One cell-granular change. */
export type NotebookCellEdit =
  | { kind: 'delete'; index: number }
  | { kind: 'insert'; index: number; cellType: string; source: string }
  | { kind: 'replace'; index: number; source: string };
