/** A line-bounded slice of a text file. */
export interface FileReadResult {
  readonly path: string;
  readonly content: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly totalLines: number;
  readonly truncated: boolean;
  readonly nextLine?: number;
  readonly hint?: string;
}

/** What `read` returns for a file that is not text. */
export interface FileBinaryResult {
  readonly path: string;
  readonly content: '';
  readonly binary: true;
  readonly size: number;
  readonly note: string;
}

/** One row of a `list` result. */
export interface FileListEntry {
  readonly path: string;
  readonly type: 'file' | 'dir' | 'symlink';
  readonly size?: number;
}

/** One `search` hit. */
export interface FileSearchMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/** A file the walker visited, with both its absolute and workspace-relative path. */
export interface WalkedFile {
  readonly absolute: string;
  readonly relative: string;
  readonly size: number;
}

/** Bounds shared by every walk. */
export interface WalkBounds {
  readonly deadline: number;
  readonly maxEntries: number;
}

/** Whether a walk stopped early, and why. */
export interface WalkState {
  timedOut: boolean;
  visited: number;
}

/** The arguments every file operation is given. */
export type FileToolArguments = Readonly<Record<string, unknown>>;
