import { KNOWLEDGE_MARKDOWN_EXTENSIONS } from './knowledge-tool.constants';

import type { KnowledgeChunk, KnowledgeHeading } from './knowledge-tool.types';

const FENCE = /^\s{0,3}(```|~~~)/u;
const ATX_HEADING = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u;
const PLAIN_WINDOW_LINES = 60;

/** The line index after any YAML front matter, which is not part of the text. */
function bodyStart(lines: readonly string[]): number {
  if (lines[0]?.trim() !== '---') return 0;
  const close = lines.findIndex((line, at) => at > 0 && line.trim() === '---');
  return close > 0 ? close + 1 : 0;
}

/** The fence state after a line: opened by ``` or ~~~, closed by the same marker. */
function nextFence(fence: string | undefined, line: string): string | undefined {
  const marker = FENCE.exec(line)?.[1];
  if (marker === undefined) return fence;
  if (fence === undefined) return marker;
  return fence === marker ? undefined : fence;
}

/** The headings of a markdown file, ignoring `#` lines inside code fences and front matter. */
export function parseHeadings(lines: readonly string[]): readonly KnowledgeHeading[] {
  const headings: KnowledgeHeading[] = [];
  let fence: string | undefined;
  for (let index = bodyStart(lines); index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const before = fence;
    fence = nextFence(fence, line);
    if (before !== undefined || fence !== undefined) continue;
    const match = ATX_HEADING.exec(line);
    const hashes = match?.[1];
    const title = match?.[2];
    if (hashes !== undefined && title !== undefined) {
      headings.push({ level: hashes.length, title: title.trim(), line: index + 1 });
    }
  }
  return headings;
}

/** Whether a file name is read as markdown (headings) rather than as plain windows. */
export function isMarkdownName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && KNOWLEDGE_MARKDOWN_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function trailFor(stack: readonly KnowledgeHeading[]): string {
  return stack.map((heading) => heading.title).join(' > ');
}

/**
 * Leaf chunks: one per heading, from the heading to the line before the next
 * heading of any level, plus an intro chunk for what comes before the first.
 * These are what search ranks, so a hit points at the part that matched.
 */
export function leafChunks(
  headings: readonly KnowledgeHeading[],
  totalLines: number,
): readonly KnowledgeChunk[] {
  const first = headings[0];
  const chunks: KnowledgeChunk[] = [];
  if (first === undefined || first.line > 1) {
    chunks.push({
      title: '(start)',
      trail: '',
      level: 0,
      startLine: 1,
      endLine: Math.max(1, (first?.line ?? totalLines + 1) - 1),
    });
  }
  const stack: KnowledgeHeading[] = [];
  headings.forEach((heading, index) => {
    while ((stack.at(-1)?.level ?? 0) >= heading.level) stack.pop();
    stack.push(heading);
    const next = headings[index + 1];
    chunks.push({
      title: heading.title,
      trail: trailFor(stack),
      level: heading.level,
      startLine: heading.line,
      endLine: Math.max(heading.line, (next?.line ?? totalLines + 1) - 1),
    });
  });
  return chunks;
}

/**
 * Sections for an outline: a heading's section runs to the next heading of the
 * same or a higher level, so a `##` includes its `###` children.
 */
export function sectionChunks(
  headings: readonly KnowledgeHeading[],
  totalLines: number,
  maxLevel: number,
): readonly KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  const stack: KnowledgeHeading[] = [];
  headings.forEach((heading, index) => {
    while ((stack.at(-1)?.level ?? 0) >= heading.level) stack.pop();
    stack.push(heading);
    if (heading.level > maxLevel) return;
    const end = headings.slice(index + 1).find((later) => later.level <= heading.level);
    chunks.push({
      title: heading.title,
      trail: trailFor(stack),
      level: heading.level,
      startLine: heading.line,
      endLine: Math.max(heading.line, (end?.line ?? totalLines + 1) - 1),
    });
  });
  return chunks;
}

/** Fixed windows for a file with no headings (a json manifest, a .cursorrules, a .txt). */
export function plainChunks(totalLines: number): readonly KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  for (let start = 1; start <= Math.max(1, totalLines); start += PLAIN_WINDOW_LINES) {
    const end = Math.min(totalLines, start + PLAIN_WINDOW_LINES - 1);
    chunks.push({
      title: `lines ${String(start)}-${String(end)}`,
      trail: '',
      level: 0,
      startLine: start,
      endLine: Math.max(start, end),
    });
  }
  return chunks;
}

/** The chunks search ranks for one file. */
export function chunksFor(name: string, lines: readonly string[]): readonly KnowledgeChunk[] {
  if (!isMarkdownName(name)) return plainChunks(lines.length);
  const headings = parseHeadings(lines);
  return headings.length === 0 ? plainChunks(lines.length) : leafChunks(headings, lines.length);
}
