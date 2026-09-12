import type { SlashInvocation } from './slash-command.types';

/**
 * The command a message invokes, if it is a command at all.
 *
 * Only a leading slash counts. A slash anywhere else is a path separator, a
 * fraction or a date, and treating those as commands would make ordinary
 * sentences fail to send.
 *
 * The name ends at the first whitespace and everything after it is arguments,
 * verbatim including inner spacing — a command that reformatted what the user
 * typed would be editing their words.
 */
export function parseSlashInvocation(text: string): SlashInvocation | undefined {
  if (!text.startsWith('/')) return undefined;
  const body = text.slice(1);
  const boundary = body.search(/\s/u);
  const name = boundary === -1 ? body : body.slice(0, boundary);
  if (name.length === 0) return undefined;
  return {
    name: name.toLowerCase(),
    argumentText: boundary === -1 ? '' : body.slice(boundary + 1).trim(),
  };
}

/**
 * The partial command being typed, for completion.
 *
 * Distinct from `parseSlashInvocation` because completing and invoking answer
 * different questions: a half-typed name should offer suggestions, never run
 * something. Completion stops as soon as an argument is being typed — by then
 * the command is chosen and the list would be in the way.
 */
export function parseSlashQuery(text: string, caretIndex: number): string | undefined {
  if (!text.startsWith('/')) return undefined;
  const caret = Math.max(0, Math.min(caretIndex, text.length));
  const typed = text.slice(1, caret);
  return /\s/u.test(typed) ? undefined : typed.toLowerCase();
}
