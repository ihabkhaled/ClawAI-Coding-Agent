/** One entry of a folder listing. */
export interface PluginDirectoryEntry {
  readonly name: string;
  readonly kind: 'directory' | 'file';
}

/**
 * The file system, as much of it as plugins need.
 *
 * Paths are absolute file-system paths. A missing folder lists as empty and a
 * missing file reads as undefined: both are ordinary here, not failures.
 */
export interface PluginFileSystemPort {
  list(path: string): Promise<readonly PluginDirectoryEntry[]>;
  readFile(path: string): Promise<Uint8Array | undefined>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  join(base: string, ...segments: string[]): string;
}

/** Where each scope's plugins live, read at call time because the folder can change. */
export interface PluginRoots {
  user(): string;
  workspace(): string | undefined;
}
