import path from 'node:path';

import {
  KNOWLEDGE_AREA_ORDER,
  KNOWLEDGE_INDEX_MAX_CHARS,
  KNOWLEDGE_INDEX_NESTED_MAX,
  KNOWLEDGE_INDEX_PREFIX_MAX,
  KNOWLEDGE_ROOT_FILES,
} from './knowledge-tool.constants';

import type { KnowledgeFile, KnowledgeKind, KnowledgeListing } from './knowledge-tool.types';

/** Bytes as a short size: `35 KB`, `1.2 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isRootInstruction(file: KnowledgeFile): boolean {
  return !file.path.includes('/') && KNOWLEDGE_ROOT_FILES.includes(file.path);
}

function fit(lines: readonly string[], limit: number): string {
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > limit) {
      out.push('(more omitted: narrow with index {prefix})');
      break;
    }
    out.push(line);
    used += line.length + 1;
  }
  return out.join('\n');
}

/** Files under one directory, sorted, each with its size. */
function listPrefix(listing: KnowledgeListing, prefix: string): string {
  const wanted = prefix.replace(/\\/gu, '/').replace(/^\.?\/+|\/+$/gu, '');
  const under = listing.files.filter(
    (file) => wanted.length === 0 || file.path === wanted || file.path.startsWith(`${wanted}/`),
  );
  if (under.length === 0) {
    return `No knowledge files under "${wanted}". Call index with no prefix for the areas.`;
  }
  const shown = under.slice(0, KNOWLEDGE_INDEX_PREFIX_MAX);
  const rows = shown.map((file) => `${file.path} ${formatBytes(file.bytes)}`);
  const more =
    under.length > shown.length ? [`(+${String(under.length - shown.length)} more)`] : [];
  return fit(
    [`${String(under.length)} knowledge files under ${wanted || '.'}:`, ...rows, ...more],
    KNOWLEDGE_INDEX_MAX_CHARS,
  );
}

function areaLines(files: readonly KnowledgeFile[]): string[] {
  const rows: string[] = [];
  for (const kind of KNOWLEDGE_AREA_ORDER) {
    const group = files.filter((file) => file.kind === kind && !isRootInstruction(file));
    if (group.length === 0) continue;
    const total = group.reduce((sum, file) => sum + file.bytes, 0);
    const label: Readonly<Record<KnowledgeKind, string>> = {
      instruction: 'nested instruction files',
      rule: 'rules',
      skill: 'skills/runbooks',
      context: 'context maps',
      doc: 'docs',
      memory: 'memory',
      ai: '.ai manifests',
      other: 'other markdown',
    };
    rows.push(`${label[kind]}: ${String(group.length)} files, ${formatBytes(total)}`);
  }
  return rows;
}

/** `index`: what knowledge exists, in sizes. With `prefix`, the files of one directory. */
export function indexKnowledge(listing: KnowledgeListing, prefix: unknown): string {
  if (typeof prefix === 'string' && prefix.trim().length > 0) return listPrefix(listing, prefix);
  const { files } = listing;
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  const roots = KNOWLEDGE_ROOT_FILES.flatMap((name) => files.filter((file) => file.path === name));
  const nested = files.filter((file) => file.kind === 'instruction' && !isRootInstruction(file));
  const topDirectories = new Map<string, number>();
  for (const file of files) {
    const top = file.path.includes('/') ? (file.path.split('/')[0] ?? '') : '';
    if (top.length > 0) topDirectories.set(top, (topDirectories.get(top) ?? 0) + 1);
  }
  const lines = [
    `${String(files.length)} knowledge files, ${formatBytes(total)}${listing.truncated ? ' (walk stopped at its limit: a prefix of the repository)' : ''}.`,
    `Root instruction files: ${roots.length === 0 ? 'none' : roots.map((file) => `${file.path} ${formatBytes(file.bytes)}`).join(', ')}.`,
    ...areaLines(files),
    `Top directories: ${[...topDirectories]
      .map(([name, count]) => `${name}/ ${String(count)}`)
      .slice(0, 24)
      .join(', ')}.`,
    ...(nested.length === 0
      ? []
      : [
          `Nested instruction files (${String(nested.length)}):`,
          ...nested
            .slice(0, KNOWLEDGE_INDEX_NESTED_MAX)
            .map((file) => `  ${file.path} ${formatBytes(file.bytes)}`),
          ...(nested.length > KNOWLEDGE_INDEX_NESTED_MAX
            ? [`  (+${String(nested.length - KNOWLEDGE_INDEX_NESTED_MAX)} more)`]
            : []),
        ]),
    'Next: task {description} names the files that govern your task; search {query}; index {prefix:"rules"} lists a directory.',
  ];
  return fit(lines, KNOWLEDGE_INDEX_MAX_CHARS);
}

/** The directory part of a path, for grouping. */
export function directoryOf(file: string): string {
  return path.posix.dirname(file);
}
