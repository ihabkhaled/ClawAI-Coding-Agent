/**
 * A model's answer, made safe to write into a terminal.
 *
 * `text` is ready for a pseudoterminal: line endings are CRLF, and no control
 * sequence survives. `strippedSequences` counts what was removed, so the
 * terminal can say that something was taken out instead of silently showing a
 * shorter answer than the model wrote.
 */
export interface TerminalSafeText {
  readonly text: string;
  readonly strippedSequences: number;
}
