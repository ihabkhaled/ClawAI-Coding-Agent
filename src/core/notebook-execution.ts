import {
  MAX_CELL_OUTPUT_CHARS,
  MAX_RUN_OUTPUT_CHARS,
  NOTEBOOK_ERROR_MIME,
} from './notebook-execution.constants';
import { redactText } from './redaction';

import type { NotebookCellRun, NotebookOutputItem } from './notebook-execution.types';

const TEXT_MIME = /^(?:text\/|application\/(?:json|x-ipynb\+json|javascript))/u;

/** Text shown for one output item, or a placeholder when it is binary. */
export function outputItemText(item: NotebookOutputItem): string {
  if (item.mime === NOTEBOOK_ERROR_MIME) return errorText(decode(item.bytes));
  if (TEXT_MIME.test(item.mime) || item.mime === 'application/vnd.code.notebook.stdout') {
    return decode(item.bytes);
  }
  if (item.mime === 'application/vnd.code.notebook.stderr') return decode(item.bytes);
  return `[${item.mime} output, ${String(item.bytes.byteLength)} bytes, not shown]`;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function errorText(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const { name, message, stack } = parsed as Record<string, unknown>;
      const head = [name, message].filter((part) => typeof part === 'string').join(': ');
      return typeof stack === 'string' && stack.length > 0 ? `${head}\n${stack}` : head;
    }
  } catch {
    // Not JSON: show what the kernel sent.
  }
  return raw;
}

/**
 * One cell's outputs as bounded, redacted text.
 *
 * Redaction runs before the cut so a secret straddling the limit cannot survive
 * as a half-masked prefix.
 */
export function boundCellOutput(
  outputs: readonly NotebookOutputItem[],
  limit: number = MAX_CELL_OUTPUT_CHARS,
): { output: string; truncated: boolean } {
  const text = redactText(outputs.map(outputItemText).join('\n'));
  if (text.length <= limit) return { output: text, truncated: false };
  return { output: `${text.slice(0, limit)}\n… output truncated …`, truncated: true };
}

/** Applies the whole-run budget, shrinking later cells first. */
export function applyRunBudget(cells: readonly NotebookCellRun[]): NotebookCellRun[] {
  let remaining = MAX_RUN_OUTPUT_CHARS;
  return cells.map((cell) => {
    if (cell.output.length <= remaining) {
      remaining -= cell.output.length;
      return cell;
    }
    const kept = Math.max(0, remaining);
    remaining = 0;
    return {
      ...cell,
      output: `${cell.output.slice(0, kept)}\n… output truncated …`,
      truncated: true,
    };
  });
}
