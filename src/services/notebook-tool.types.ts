/** Reading a notebook file, narrowed to the one call the tool makes. */
export interface NotebookReaderPort {
  read(rootKey: string, path: string): Promise<string>;
}
