/**
 * One line of what the agent is doing, before it is put into words.
 *
 * Deliberately not prose. This module is pure and the extension renders in
 * thirteen languages, so a sentence built here would either be English only or
 * would drag localisation into the core. `toolName` and `subject` are facts;
 * the verb belongs to whoever is displaying them.
 */
export interface ToolActivity {
  /** The tool as the protocol names it, e.g. `workspace.command`. */
  readonly toolName: string;
  /** The operation within that tool, when the call names one. */
  readonly operation?: string;
  /**
   * What the call is about: a path, a command, a query.
   *
   * Empty when the arguments name nothing recognisable. An empty subject is a
   * real answer — the line still says which tool ran — and is why this never
   * invents a placeholder.
   */
  readonly subject: string;
  /** How many further subjects the call carried, for "and 3 more". */
  readonly additional: number;
}
