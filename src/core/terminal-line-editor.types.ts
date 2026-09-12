/** What the reader did, once a keystroke completed something. */
export type TerminalLineSignal = 'submit' | 'cancel' | 'close';

/**
 * One step of the terminal's input line.
 *
 * `buffer` is the line as it now stands, `echo` is exactly what the terminal
 * should write so the screen matches it, and `signal` is set only on the
 * keystroke that finished something. Keeping the echo beside the buffer is what
 * stops the two from drifting: a pseudoterminal draws nothing on its own, so a
 * buffer change with no echo is an invisible edit.
 */
export interface TerminalLineState {
  readonly buffer: string;
  readonly echo: string;
  readonly signal?: TerminalLineSignal;
}
