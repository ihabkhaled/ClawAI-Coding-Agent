import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import { redactText } from '../core/redaction';
import { containedPath } from '../core/workspace-containment';

import { isMarkdownName, parseHeadings, sectionChunks } from './knowledge-chunks';
import { knowledgeKind, posixPath } from './knowledge-files';
import { integerArgument, withoutHidden } from './knowledge-sanitize';
import {
  KNOWLEDGE_OUTLINE_MAX_ENTRIES,
  KNOWLEDGE_OUTLINE_MAX_LEVEL,
  KNOWLEDGE_READ_MAX_CHARS,
  KNOWLEDGE_READ_MAX_FILE_BYTES,
} from './knowledge-tool.constants';

import type { KnowledgeChunk } from './knowledge-tool.types';

type Args = Readonly<Record<string, unknown>>;

/** A path argument, resolved to a workspace-relative knowledge path or an error the model can act on. */
export function resolveKnowledgePath(workspace: string, raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(
      'knowledge.context read needs "path": a workspace-relative file such as "CLAUDE.md".',
    );
  }
  const root = realpathSync(workspace);
  const absolute = path.resolve(root, raw.trim());
  const relative = posixPath(path.relative(root, absolute));
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative.length === 0) {
    throw new Error('knowledge.context reads only files inside the workspace.');
  }
  if (knowledgeKind(relative) === undefined) {
    throw new Error(
      `${relative} is not a knowledge file. knowledge.context reads markdown and files under rules/, skills/, context/, docs/, memory/ and .ai/; use workspace.file for code.`,
    );
  }
  // Rejects a symbolic link and any path whose real location leaves the workspace.
  containedPath(workspace, relative);
  return relative;
}

function lineArgument(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  const line = integerArgument(value);
  if (line === undefined || line < 1) {
    throw new Error(`knowledge.context read: "${name}" is a line number counted from 1.`);
  }
  return line;
}

function outline(relative: string, lines: readonly string[], bytes: number): string {
  const headings = parseHeadings(lines);
  const sections: readonly KnowledgeChunk[] = isMarkdownName(relative)
    ? sectionChunks(headings, lines.length, KNOWLEDGE_OUTLINE_MAX_LEVEL)
    : [];
  const shown = sections.slice(0, KNOWLEDGE_OUTLINE_MAX_ENTRIES);
  const rows = shown.map(
    (section) =>
      `${'  '.repeat(Math.max(0, section.level - 1))}${String(section.startLine)}-${String(section.endLine)} ${section.title}`,
  );
  const more =
    sections.length > shown.length
      ? [`(${String(sections.length - shown.length)} more sections)`]
      : [];
  return [
    `${relative}: ${String(lines.length)} lines, ${String(bytes)} bytes: too large to return whole (limit ${String(KNOWLEDGE_READ_MAX_CHARS)} chars).`,
    'Outline (start-end title). Call read {path, startLine, endLine} for the part you need:',
    ...(rows.length === 0
      ? ['(no headings: read it in line windows, e.g. startLine 1, endLine 120)']
      : rows),
    ...more,
  ].join('\n');
}

/** The lines a range selects, cut to the character limit with the next line named. */
function slice(
  relative: string,
  lines: readonly string[],
  from: number,
  requestedEnd: number,
): string {
  const end = Math.min(requestedEnd, lines.length);
  const out: string[] = [];
  let used = 0;
  let line = from;
  for (; line <= end; line += 1) {
    const text = lines[line - 1] ?? '';
    if (used + text.length + 1 > KNOWLEDGE_READ_MAX_CHARS && out.length > 0) break;
    out.push(
      text.length > KNOWLEDGE_READ_MAX_CHARS ? `${text.slice(0, KNOWLEDGE_READ_MAX_CHARS)}…` : text,
    );
    used += text.length + 1;
  }
  const last = from + out.length - 1;
  const header = `${relative} lines ${String(from)}-${String(last)} of ${String(lines.length)}`;
  const tail =
    last < end
      ? `\n(cut at ${String(KNOWLEDGE_READ_MAX_CHARS)} chars: continue at startLine ${String(last + 1)})`
      : '';
  return `${header}\n${out.join('\n')}${tail}`;
}

/** The size of a knowledge file, with the errors a model can act on. */
function sizeOfFile(absolute: string, relative: string): number {
  let bytes: number | undefined;
  try {
    const info = statSync(absolute);
    bytes = info.isFile() ? info.size : undefined;
  } catch {
    bytes = undefined;
  }
  if (bytes === undefined) {
    throw new Error(
      `${relative} does not exist. Use knowledge.context index or search to find the right path.`,
    );
  }
  if (bytes > KNOWLEDGE_READ_MAX_FILE_BYTES) {
    throw new Error(
      `${relative} is ${String(bytes)} bytes, over the ${String(KNOWLEDGE_READ_MAX_FILE_BYTES)} byte limit for knowledge.context.`,
    );
  }
  return bytes;
}

/** The requested line window, checked against the file; undefined parts mean "not given". */
function lineWindow(
  relative: string,
  total: number,
  args: Args,
): { from: number | undefined; to: number | undefined } {
  const from = lineArgument(args.startLine, 'startLine');
  const to = lineArgument(args.endLine, 'endLine');
  if (from !== undefined && from > total) {
    throw new Error(
      `${relative} has ${String(total)} lines; startLine ${String(from)} is past the end.`,
    );
  }
  if (to !== undefined && from !== undefined && to < from) {
    throw new Error('knowledge.context read: endLine is before startLine.');
  }
  return { from, to };
}

/** Redacts after hidden characters are gone, so a secret split by zero-width characters cannot slip past. */
function redactHidden(text: string): string {
  return redactText(withoutHidden(text));
}

/** `read`: a bounded slice of one knowledge file, or its outline when it is too large to return whole. */
export function readKnowledge(workspace: string, args: Args): string {
  const relative = resolveKnowledgePath(workspace, args.path);
  const absolute = path.join(workspace, relative);
  const bytes = sizeOfFile(absolute, relative);
  const lines = readFileSync(absolute, 'utf8').split(/\r?\n/u);
  const { from, to } = lineWindow(relative, lines.length, args);
  if (from === undefined && to === undefined) {
    const whole = lines.join('\n');
    return redactHidden(
      whole.length > KNOWLEDGE_READ_MAX_CHARS
        ? outline(relative, lines, bytes)
        : `${relative} (${String(lines.length)} lines)\n${whole}`,
    );
  }
  const first = from ?? 1;
  return redactHidden(slice(relative, lines, first, to ?? first + 199));
}
