import { describe, expect, it } from 'vitest';

import { applyTerminalInput, EMPTY_LINE } from '../../src/core/terminal-line-editor';
import { toTerminalSafeText } from '../../src/core/terminal-output';

const ESC = '\u001B';

describe('toTerminalSafeText', () => {
  it('keeps ordinary prose and gives it terminal line endings', () => {
    expect(toTerminalSafeText('first\nsecond')).toEqual({
      text: 'first\r\nsecond',
      strippedSequences: 0,
    });
  });

  it('does not double a line ending that is already CRLF', () => {
    expect(toTerminalSafeText('first\r\nsecond').text).toBe('first\r\nsecond');
  });

  it('removes a screen-clearing sequence', () => {
    expect(toTerminalSafeText(`before${ESC}[2Jafter`)).toEqual({
      text: 'beforeafter',
      strippedSequences: 1,
    });
  });

  it('removes a window-title sequence terminated by a bell', () => {
    expect(toTerminalSafeText(`${ESC}]0;owned\u0007ok`)).toEqual({
      text: 'ok',
      strippedSequences: 1,
    });
  });

  it('removes a hyperlink sequence terminated by a string terminator', () => {
    const answer = `${ESC}]8;;https://evil.test${ESC}\\click here${ESC}]8;;${ESC}\\`;

    expect(toTerminalSafeText(answer)).toEqual({
      text: 'click here',
      strippedSequences: 2,
    });
  });

  it('consumes a sequence that runs off the end rather than leaving its tail', () => {
    expect(toTerminalSafeText(`text${ESC}[38;5`)).toEqual({ text: 'text', strippedSequences: 1 });
  });

  it('removes a lone escape so it cannot combine with what follows', () => {
    expect(toTerminalSafeText(`a${ESC}b`)).toEqual({ text: 'ab', strippedSequences: 1 });
  });

  it('removes backspace so a model cannot overprint what it already wrote', () => {
    expect(toTerminalSafeText('safe\b\b\b\bevil')).toEqual({
      text: 'safeevil',
      strippedSequences: 4,
    });
  });

  it('keeps tabs, which are text rather than an instruction', () => {
    expect(toTerminalSafeText('name\tvalue').text).toBe('name\tvalue');
  });
});

describe('applyTerminalInput', () => {
  it('echoes what was typed and keeps it in the buffer', () => {
    expect(applyTerminalInput(EMPTY_LINE, 'hi')).toEqual({ buffer: 'hi', echo: 'hi' });
  });

  it('submits on Enter and hands back the line', () => {
    const typed = applyTerminalInput(EMPTY_LINE, 'run tests');

    expect(applyTerminalInput(typed, '\r')).toEqual({
      buffer: 'run tests',
      echo: '\r\n',
      signal: 'submit',
    });
  });

  it('takes a pasted line in one call and stops at its newline', () => {
    expect(applyTerminalInput(EMPTY_LINE, 'first\rsecond')).toEqual({
      buffer: 'first',
      echo: 'first\r\n',
      signal: 'submit',
    });
  });

  it('erases a column on backspace', () => {
    const typed = applyTerminalInput(EMPTY_LINE, 'abc');

    expect(applyTerminalInput(typed, '\u007F')).toEqual({ buffer: 'ab', echo: '\b \b' });
  });

  it('rings rather than erasing past the start of the line', () => {
    expect(applyTerminalInput(EMPTY_LINE, '\u007F')).toEqual({ buffer: '', echo: '\u0007' });
  });

  it('cancels on Ctrl+C and clears the line', () => {
    const typed = applyTerminalInput(EMPTY_LINE, 'half a thought');

    expect(applyTerminalInput(typed, '\u0003')).toEqual({
      buffer: '',
      echo: '^C\r\n',
      signal: 'cancel',
    });
  });

  it('closes on Ctrl+D only when the line is empty', () => {
    expect(applyTerminalInput(EMPTY_LINE, '\u0004').signal).toBe('close');
    expect(applyTerminalInput({ buffer: 'x', echo: '' }, '\u0004').signal).toBeUndefined();
  });

  it('drops an arrow key instead of writing its bytes into the prompt', () => {
    const typed = applyTerminalInput(EMPTY_LINE, 'keep');

    expect(applyTerminalInput(typed, `${ESC}[A`)).toEqual({ buffer: 'keep', echo: '' });
  });

  it('keeps a character outside the basic plane whole', () => {
    expect(applyTerminalInput(EMPTY_LINE, 'ok \u{1F600}')).toEqual({
      buffer: 'ok \u{1F600}',
      echo: 'ok \u{1F600}',
    });
  });
});
