/** What resolving a composer drop needs to reach. */
export interface DropUrisDependencies {
  /** The open folder's filesystem path, or nothing when none is open. */
  readonly workspaceRoot: () => string | undefined;
  readonly appendToComposer: (text: string) => Promise<void>;
}
