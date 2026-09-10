import { escapeSequenceEnd } from './terminal-output';
import { BELL, C0_LAST, DELETE, ESCAPE } from './terminal-output.constants';

import type { TerminalLineState } from './terminal-line-editor.types';

/** Ctrl+C — abandon the line, and the run if one is going. */
const CANCEL = 0x03;
/** Ctrl+D — close the terminal, but only on an empty line, as a shell does. */
const CLOSE = 0x04;
const BACKSPACE = 0x08;
const CARRIAGE_RETURN = 0x0d;
const LINE_FEED = 0x0a;

/** Erase one column: back up, overwrite with a space, back up again. */
const ERASE = '\b \b';

export const EMPTY_LINE: TerminalLineState = { buffer: '', echo: '' };

function backspace(buffer: string): TerminalLineState {
  if (buffer.length === 0) {
    // Nothing to erase. A bell is the honest answer; erasing anyway would eat
    // the prompt the terminal drew before the line started.
    return { buffer, echo: String.fromCharCode(BELL) };
  }
  return { buffer: buffer.slice(0, -1), echo: ERASE };
}

/**
 * Folds one keystroke into the line being typed.
 *
 * A pseudoterminal receives raw bytes and draws nothing by itself, so every
 * rule a shell provides for free has to be stated here: what echoes, what
 * erases, what submits, and what is silently dropped.
 *
 * Arrow keys and every other escape sequence are dropped rather than inserted.
 * A terminal that echoed them would show `^[[A` where the reader expected their
 * previous line, and the buffer would carry bytes the model was never meant to
 * read. Dropping is not a missing feature so much as the honest floor: history
 * and cursor movement are a separate thing to build, and inserting garbage in
 * the meantime is worse than doing nothing.
 */
export function applyTerminalKey(state: TerminalLineState, data: string): TerminalLineState {
  if (data.length === 0) {
    return { buffer: state.buffer, echo: '' };
  }
  const code = data.charCodeAt(0);
  if (code === CARRIAGE_RETURN || code === LINE_FEED) {
    return { buffer: state.buffer, echo: '\r\n', signal: 'submit' };
  }
  if (code === CANCEL) {
    return { buffer: '', echo: '^C\r\n', signal: 'cancel' };
  }
  if (code === CLOSE && state.buffer.length === 0) {
    return { buffer: '', echo: '\r\n', signal: 'close' };
  }
  if (code === BACKSPACE || code === DELETE) {
    return backspace(state.buffer);
  }
  if (code === ESCAPE || code <= C0_LAST) {
    return { buffer: state.buffer, echo: '' };
  }
  return { buffer: state.buffer + data, echo: data };
}

/**
 * Folds a whole chunk, because a paste arrives as one `handleInput` call and a
 * terminal that read only its first character would drop the rest of the line.
 * Echo is concatenated so the screen still matches, and the first signal wins:
 * everything after a submit belongs to the next line, not this one.
 */
export function applyTerminalInput(state: TerminalLineState, data: string): TerminalLineState {
  let current: TerminalLineState = { buffer: state.buffer, echo: '' };
  let echo = '';
  let index = 0;
  while (index < data.length) {
    // An escape sequence is skipped whole. Dropping only its `ESC` would leave
    // `[A` behind, and an arrow key would type two letters into the prompt.
    if (data.charCodeAt(index) === ESCAPE) {
      index = escapeSequenceEnd(data, index);
      continue;
    }
    const character = String.fromCodePoint(data.codePointAt(index) ?? 0);
    const next = applyTerminalKey(current, character);
    echo += next.echo;
    if (next.signal !== undefined) {
      return { buffer: next.buffer, echo, signal: next.signal };
    }
    current = next;
    index += character.length;
  }
  return { buffer: current.buffer, echo };
}
