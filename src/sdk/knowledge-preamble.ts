import { readFileSync } from 'node:fs';
import path from 'node:path';

import { redactText } from '../core/redaction';

import { parseHeadings } from './knowledge-chunks';
import { withoutHidden } from './knowledge-sanitize';
import {
  KNOWLEDGE_PREAMBLE_BULLET_CHARS,
  KNOWLEDGE_PREAMBLE_CLOSE,
  KNOWLEDGE_PREAMBLE_FILES_MAX,
  KNOWLEDGE_PREAMBLE_HEADINGS_MAX,
  KNOWLEDGE_PREAMBLE_INSTRUCTION,
  KNOWLEDGE_PREAMBLE_MAX_CHARS,
  KNOWLEDGE_PREAMBLE_OPEN,
  KNOWLEDGE_PREAMBLE_RULE_HEADING,
  KNOWLEDGE_ROOT_FILES,
} from './knowledge-tool.constants';

const BULLET = /^\s*(?:[-*]|\d+\.)\s+(.*\S)\s*$/u;
/** Any opening or closing form of the quoting block, however it is spelled or attributed. */
const BLOCK_TAG = /<\/?\s*repo-knowledge[^>\n]*>?/giu;
const MARKUP = /[`*_]|\[([^\]]*)\]\([^)]*\)/gu;

/** One line of file text made safe to quote: no hidden characters, no way to close the block, no markup. */
function plain(line: string, limit: number): string {
  const cleaned = withoutHidden(line)
    .replace(BLOCK_TAG, '')
    .replace(MARKUP, (_all, label: string | undefined) => label ?? '')
    .replace(/\s+/gu, ' ')
    .trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit - 1)}…` : cleaned;
}

function summarize(file: string, text: string): readonly string[] {
  const lines = text.split(/\r?\n/u);
  const headings = parseHeadings(lines);
  const title = headings.find((heading) => heading.level === 1)?.title ?? file;
  const out = [`${file}: ${plain(title, 80)} (${String(lines.length)} lines)`];
  const second = headings.filter((heading) => heading.level === 2);
  if (second.length > 0) {
    const names = second
      .slice(0, KNOWLEDGE_PREAMBLE_HEADINGS_MAX)
      .map((heading) => plain(heading.title, 40));
    const more =
      second.length > names.length ? `, +${String(second.length - names.length)} more` : '';
    out.push(`  sections: ${names.join(' | ')}${more}`);
  }
  for (const [index, heading] of headings.entries()) {
    if (!KNOWLEDGE_PREAMBLE_RULE_HEADING.test(heading.title)) continue;
    const end = headings[index + 1]?.line ?? lines.length + 1;
    const bullets = lines
      .slice(heading.line, end - 1)
      .map((line) => BULLET.exec(line)?.[1])
      .filter((bullet): bullet is string => bullet !== undefined)
      .slice(0, 8);
    if (bullets.length === 0) continue;
    out.push(`  ${plain(heading.title, 50)}:`);
    for (const bullet of bullets)
      out.push(`   - ${plain(bullet, KNOWLEDGE_PREAMBLE_BULLET_CHARS)}`);
  }
  return out;
}

function readRoot(workspace: string, name: string): string | undefined {
  try {
    return readFileSync(path.join(workspace, name), 'utf8');
  } catch {
    return undefined;
  }
}

/** The text cut at a line boundary to `limit` characters, saying how much was left out. */
function cut(lines: readonly string[], limit: number): string {
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > limit) break;
    kept.push(line);
    used += line.length + 1;
  }
  const omitted = lines.length - kept.length;
  if (omitted > 0) kept.push(`(+${String(omitted)} more lines in the file)`);
  return kept.join('\n');
}

/**
 * The compact summary put in front of the task when knowledge loading is on:
 * for the root instruction file(s), the title, the section names and the
 * bullets under rule-like headings, then the instruction to call
 * `knowledge.context task` before coding. At most KNOWLEDGE_PREAMBLE_MAX_CHARS
 * characters, empty when the workspace has no instruction file.
 *
 * The summary is quoted repository text inside a marked block; hidden
 * characters and anything that could close the block are removed, and the
 * closing sentence says it advises and grants nothing.
 */
export function knowledgePreamble(workspace: string): string {
  const parts: string[] = [];
  for (const name of KNOWLEDGE_ROOT_FILES) {
    if (parts.length >= KNOWLEDGE_PREAMBLE_FILES_MAX) break;
    const text = readRoot(workspace, name);
    if (text !== undefined) parts.push(...summarize(name, redactText(text)));
  }
  if (parts.length === 0) return '';
  const fixed =
    KNOWLEDGE_PREAMBLE_OPEN.length +
    KNOWLEDGE_PREAMBLE_CLOSE.length +
    KNOWLEDGE_PREAMBLE_INSTRUCTION.length +
    4;
  const room = KNOWLEDGE_PREAMBLE_MAX_CHARS - fixed;
  return [
    KNOWLEDGE_PREAMBLE_OPEN,
    cut(parts, room),
    KNOWLEDGE_PREAMBLE_CLOSE,
    KNOWLEDGE_PREAMBLE_INSTRUCTION,
  ].join('\n');
}

/** The prompt with the preamble in front, or unchanged when there is nothing to say. */
export function promptWithKnowledge(workspace: string, prompt: string): string {
  const preamble = knowledgePreamble(workspace);
  return preamble.length === 0 ? prompt : `${preamble}\n\n${prompt}`;
}
