/** The slice of VS Code's workspace storage checkpoints use. */
export interface CheckpointStoragePort {
  get(key: string): unknown;
  update(key: string, value: unknown): Thenable<void>;
}
