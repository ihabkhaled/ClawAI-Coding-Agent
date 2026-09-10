import {
  BELL,
  C0_LAST,
  CARRIAGE_RETURN,
  CSI_FINAL_FIRST,
  CSI_FINAL_LAST,
  CSI_INTERMEDIATE_FIRST,
  CSI_INTERMEDIATE_LAST,
  CSI_INTRODUCER,
  CSI_PARAMETER_FIRST,
  CSI_PARAMETER_LAST,
  DELETE,
  ESCAPE,
  LINE_FEED,
  OSC_INTRODUCER,
  SHORT_ESCAPE_FIRST,
  SHORT_ESCAPE_LAST,
  STRING_TERMINATOR_FINAL,
  TAB,
} from './terminal-output.constants';

import type { TerminalSafeText } from './terminal-output.types';

function isKeptControl(code: number): boolean {
  return code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN;
}

function within(code: number, first: number, last: number): boolean {
  return code >= first && code <= last;
}

/**
 * Where a `ESC [` sequence ends: parameter bytes, then intermediate bytes,
 * then exactly one final byte. A sequence that runs off the end of the string
 * consumes the rest, because leaving its tail behind would let the next chunk
 * of model output complete it.
 */
function endOfCsi(value: string, start: number): number {
  let index = start + 2;
  while (
    index < value.length &&
    within(value.charCodeAt(index), CSI_PARAMETER_FIRST, CSI_PARAMETER_LAST)
  ) {
    index += 1;
  }
  while (
    index < value.length &&
    within(value.charCodeAt(index), CSI_INTERMEDIATE_FIRST, CSI_INTERMEDIATE_LAST)
  ) {
    index += 1;
  }
  if (index < value.length && within(value.charCodeAt(index), CSI_FINAL_FIRST, CSI_FINAL_LAST)) {
    return index + 1;
  }
  return value.length;
}

/** `ESC ]` runs until a bell or a string terminator, or to the end of the text. */
function endOfOsc(value: string, start: number): number {
  let index = start + 2;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === BELL) {
      return index + 1;
    }
    if (code === ESCAPE && value.charCodeAt(index + 1) === STRING_TERMINATOR_FINAL) {
      return index + 2;
    }
    index += 1;
  }
  return value.length;
}

/**
 * Where the escape sequence beginning at `start` ends. Exported because the
 * line editor has to skip one as a unit: dropping only the `ESC` byte leaves
 * `[A` behind, and an arrow key becomes two letters in the prompt.
 */
export function escapeSequenceEnd(value: string, start: number): number {
  const next = value.charCodeAt(start + 1);
  if (next === CSI_INTRODUCER) {
    return endOfCsi(value, start);
  }
  if (next === OSC_INTRODUCER) {
    return endOfOsc(value, start);
  }
  if (within(next, SHORT_ESCAPE_FIRST, SHORT_ESCAPE_LAST)) {
    return start + 2;
  }
  return start + 1;
}

/**
 * A pseudoterminal does not return to column zero on a bare line feed, so text
 * written with Unix endings walks diagonally down the screen. Existing pairs
 * are normalised rather than doubled.
 */
function toCrlf(value: string): string {
  return value.replace(/\r\n|\r|\n/gu, '\r\n');
}

/**
 * Makes a model's answer safe to write into a terminal.
 *
 * A pseudoterminal renders whatever it is handed, so writing an answer into one
 * straight from the wire hands the model a cursor. `ESC [ 2J` clears the
 * scrollback the user was reading, `ESC ] 0 ; …` rewrites the window title, and
 * `ESC ] 8 ; ; …` turns any word into a hyperlink to any address, which makes an
 * answer a phishing surface. An answer needs none of them, and a repository the
 * agent read can put them in the model's mouth.
 *
 * Backspace is stripped for the same reason: it lets a model overprint what it
 * already wrote, so the terminal shows something other than what was sent.
 *
 * `strippedSequences` is returned rather than kept quiet, so the terminal can
 * say something was removed instead of showing a shorter answer than the model
 * wrote.
 */
export function toTerminalSafeText(value: string): TerminalSafeText {
  let kept = '';
  let strippedSequences = 0;
  let index = 0;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === ESCAPE) {
      index = escapeSequenceEnd(value, index);
      strippedSequences += 1;
      continue;
    }
    if ((code <= C0_LAST && !isKeptControl(code)) || code === DELETE) {
      index += 1;
      strippedSequences += 1;
      continue;
    }
    kept += String.fromCharCode(code);
    index += 1;
  }
  return { text: toCrlf(kept), strippedSequences };
}
