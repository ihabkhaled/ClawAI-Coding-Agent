import { redactText } from './redaction';

import type { TerminalCapture } from './terminal-reference.types';

/** How much terminal output one reference may carry. */
export const MAX_TERMINAL_OUTPUT_BYTES = 32 * 1024;

/**
 * Terminal output, trimmed to what a reader needs.
 *
 * The end is kept, not the start. A build that scrolled for two thousand lines
 * is being referenced because of how it ended; the first lines are the
 * compiler saying hello. This is the same choice the process tool's output
 * truncation makes, for the same reason.
 */
export function trimTerminalOutput(output: string): { text: string; truncated: boolean } {
  if (output.length <= MAX_TERMINAL_OUTPUT_BYTES) return { text: output, truncated: false };
  return { text: output.slice(-MAX_TERMINAL_OUTPUT_BYTES), truncated: true };
}

/**
 * A terminal reference as the model sees it.
 *
 * Tagged as terminal output rather than pasted in as prose, for the same
 * reason workspace files are tagged: this is a transcript of something that
 * happened, not an instruction, and a build log that happens to contain the
 * words "ignore previous instructions" is still just a build log.
 *
 * Redacted before it is framed. Terminal output is where tokens end up — an
 * environment dump, a curl with a header, a failed login.
 */
export function terminalReferenceBlock(capture: TerminalCapture): string {
  const trimmed = trimTerminalOutput(capture.output);
  const attributes = [
    `name="${escapeAttribute(capture.terminalName)}"`,
    capture.command === undefined ? '' : `command="${escapeAttribute(capture.command)}"`,
    capture.exitCode === undefined ? '' : `exitCode="${String(capture.exitCode)}"`,
    trimmed.truncated ? 'truncated="true"' : '',
  ]
    .filter((attribute) => attribute.length > 0)
    .join(' ');
  return `<terminal ${attributes}>\n${redactText(trimmed.text)}\n</terminal>`;
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
