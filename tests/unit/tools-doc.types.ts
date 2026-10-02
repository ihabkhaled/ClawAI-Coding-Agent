/** What a person wrote about one tool; everything the code can say itself is generated. */
export interface ToolNote {
  readonly tool: string;
  /** One sentence, plain words. */
  readonly purpose: string;
  /** The flag or SDK option that offers the tool. */
  readonly enable: string;
  /** Operation name to "{arguments}: what it does". Must list exactly the tool's real operations. */
  readonly operations: Readonly<Record<string, string>>;
  readonly limits: readonly string[];
  /** `message` is a fragment that must exist in `src/`, so a reworded message fails the drift test. */
  readonly failures: readonly { readonly message: string; readonly meaning: string }[];
  /** A command line that must parse with the real argument parser. */
  readonly cli: string;
  readonly sdk: string;
}

/** One row of the generated permission table. */
export interface PermissionRow {
  readonly operations: readonly string[];
  readonly category: string;
  readonly cells: readonly string[];
}
