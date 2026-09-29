/** The git worktree a session is working in instead of the main checkout. */
export interface SessionWorktree {
  /** The key every workspace.files, workspace.git and command call addresses it by. */
  readonly rootKey: string;
  /** Relative to the checkout it was created from. */
  readonly path: string;
  readonly branch: string;
  /** The checkout it was created from, which exit returns to. */
  readonly baseRootKey: string;
}
