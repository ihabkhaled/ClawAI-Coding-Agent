/** The slice of VS Code's workspace storage the group store uses. */
export interface WorkspaceMemento {
  get(key: string): unknown;
  update(key: string, value: unknown): Thenable<void>;
}
