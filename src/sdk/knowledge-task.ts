import path from 'node:path';

import { formatBytes } from './knowledge-index';
import { pathScore, rankChunks, snippetIn, termWeights, termsOf } from './knowledge-search';
import {
  KNOWLEDGE_GENERIC_SEGMENTS,
  KNOWLEDGE_ROOT_FILES,
  KNOWLEDGE_TASK_FOOTER,
  KNOWLEDGE_TASK_MAX_CHARS,
  KNOWLEDGE_TASK_SNIPPET_CHARS,
  KNOWLEDGE_WHOLE_FILE_LINES,
  KNOWLEDGE_WEIGHTS,
} from './knowledge-tool.constants';

import type { TermWeights } from './knowledge-search';
import type {
  KnowledgeCorpus,
  KnowledgeDocument,
  KnowledgeHit,
  KnowledgeKind,
  KnowledgeTerms,
} from './knowledge-tool.types';

const LINK_TARGET = /(?:\]\(|`)([A-Za-z0-9_./-]+\.(?:md|mdx))/gu;

/** One governing file, with the part of it that matters. */
interface Pick {
  readonly document: KnowledgeDocument;
  readonly startLine: number;
  readonly endLine: number;
  readonly title: string;
  readonly why: string;
  readonly score: number;
}

function isRoot(document: KnowledgeDocument): boolean {
  return !document.file.path.includes('/') && KNOWLEDGE_ROOT_FILES.includes(document.file.path);
}

function pick(hit: KnowledgeHit, why: string): Pick {
  // A short file is read whole: a range inside it saves nothing.
  const small = hit.document.lines.length <= KNOWLEDGE_WHOLE_FILE_LINES;
  return {
    document: hit.document,
    startLine: small ? 1 : hit.chunk.startLine,
    endLine: small ? hit.document.lines.length : hit.chunk.endLine,
    title: hit.chunk.title,
    why,
    score: hit.score,
  };
}

/** Knowledge files a root instruction file points at in the sections that matched. */
function linkedFromRoot(
  corpus: KnowledgeCorpus,
  rootHits: readonly KnowledgeHit[],
): ReadonlyMap<string, number> {
  const known = new Set(corpus.documents.map((document) => document.file.path));
  const boost = new Map<string, number>();
  for (const hit of rootHits) {
    const text = hit.document.lines.slice(hit.chunk.startLine - 1, hit.chunk.endLine).join('\n');
    for (const match of text.matchAll(LINK_TARGET)) {
      const target = match[1];
      if (target === undefined) continue;
      const normalized = path.posix.normalize(target.replace(/^\.\//u, ''));
      if (known.has(normalized)) boost.set(normalized, KNOWLEDGE_WEIGHTS.linkedFromRoot);
    }
  }
  return boost;
}

/** Workspace-local instruction files whose directory the task names (`chat-service` finds apps/claw-chat-service/CLAUDE.md). */
function localInstructions(
  corpus: KnowledgeCorpus,
  terms: KnowledgeTerms,
): readonly KnowledgeDocument[] {
  const scored: { document: KnowledgeDocument; score: number }[] = [];
  for (const document of corpus.documents) {
    if (document.file.kind !== 'instruction' || isRoot(document)) continue;
    const directory = path.posix.dirname(document.file.path).toLowerCase();
    const name = path.posix.basename(directory).replace(/^claw-/u, '');
    let score = name.length >= 4 && terms.raw.includes(name) ? 10 : 0;
    for (const segment of directory.split(/[/_.-]/u)) {
      if (
        segment.length >= 3 &&
        !KNOWLEDGE_GENERIC_SEGMENTS.has(segment) &&
        terms.words.includes(segment)
      ) {
        score += 3;
      }
    }
    if (score > 0) scored.push({ document, score });
  }
  scored.sort(
    (a, b) => b.score - a.score || a.document.file.path.localeCompare(b.document.file.path),
  );
  return scored.slice(0, 3).map((entry) => entry.document);
}

function bestPerFile(hits: readonly KnowledgeHit[], kind: KnowledgeKind): readonly Pick[] {
  const seen = new Set<string>();
  const picks: Pick[] = [];
  for (const hit of hits) {
    if (hit.document.file.kind !== kind || seen.has(hit.document.file.path)) continue;
    seen.add(hit.document.file.path);
    picks.push(pick(hit, hit.matched.slice(0, 4).join(', ')));
  }
  return picks;
}

function line(entry: Pick, input: RenderInput): string {
  const { document } = entry;
  const whole = entry.startLine <= 1 && entry.endLine >= document.lines.length;
  const range = whole ? '' : `:${String(entry.startLine)}-${String(entry.endLine)}`;
  const heading =
    entry.title === '(start)' || /^lines \d/u.test(entry.title)
      ? ''
      : ` "${entry.title.slice(0, 70)}"`;
  const note = snippetIn(
    document,
    entry.startLine,
    entry.endLine,
    input.terms,
    KNOWLEDGE_TASK_SNIPPET_CHARS,
    input.weights,
  );
  const head = `- ${document.file.path}${range} (${formatBytes(document.file.bytes)})${heading}`;
  return note.length === 0 ? head : `${head}\n    > ${note}`;
}

interface Sections {
  readonly root: readonly Pick[];
  readonly rules: readonly Pick[];
  readonly skills: readonly Pick[];
  readonly local: readonly Pick[];
  readonly docs: readonly Pick[];
}

interface RenderInput {
  readonly description: string;
  readonly terms: KnowledgeTerms;
  readonly weights: TermWeights;
  readonly partial: boolean;
}

function render(input: RenderInput, sections: Sections): string {
  const read = [
    ...sections.root.slice(0, 1),
    ...sections.rules.slice(0, 3),
    ...sections.local.slice(0, 1),
    ...sections.skills.slice(0, 1),
  ];
  const readList = read.map((entry, index) => {
    const range =
      entry.startLine > 1 || entry.endLine < entry.document.lines.length
        ? `, startLine ${String(entry.startLine)}, endLine ${String(entry.endLine)}`
        : '';
    return `${String(index + 1)}. ${entry.document.file.path}${range}`;
  });
  const groups: readonly [string, readonly Pick[]][] = [
    ['Root instruction index (matching sections)', sections.root],
    ['Rules', sections.rules],
    ['Skills / runbooks', sections.skills],
    ['Workspace-local instructions', sections.local],
    ['Docs and context', sections.docs],
  ];
  const body = groups.flatMap(([title, entries]) =>
    entries.length === 0 ? [] : [`${title}:`, ...entries.map((entry) => line(entry, input))],
  );
  const header = [
    `Task: ${input.description.replace(/\s+/gu, ' ').slice(0, 100)}`,
    'Read these first (read {path, startLine, endLine}):',
    ...readList,
    '',
  ];
  const footer = [
    ...(input.partial ? ['(some large files were not searched; use search to look further)'] : []),
    KNOWLEDGE_TASK_FOOTER,
  ];
  return [...header, ...body, ...footer].join('\n');
}

function trimTo(sections: Sections, input: RenderInput): string {
  let current = sections;
  let text = render(input, current);
  const order: (keyof Sections)[] = ['docs', 'skills', 'local', 'rules', 'root'];
  while (text.length > KNOWLEDGE_TASK_MAX_CHARS) {
    const key = order.find(
      (name) => current[name].length > (name === 'root' ? 1 : name === 'rules' ? 3 : 0),
    );
    if (key === undefined) return text.slice(0, KNOWLEDGE_TASK_MAX_CHARS);
    current = { ...current, [key]: current[key].slice(0, -1) };
    text = render(input, current);
  }
  return text;
}

/** The primary root instruction file: the first of CLAUDE.md, AGENTS.md ... that exists. */
function primaryRoot(corpus: KnowledgeCorpus): KnowledgeDocument | undefined {
  for (const name of KNOWLEDGE_ROOT_FILES) {
    const found = corpus.documents.find((document) => document.file.path === name);
    if (found !== undefined) return found;
  }
  return undefined;
}

function wholeFile(document: KnowledgeDocument, why: string): Pick {
  return { document, startLine: 1, endLine: document.lines.length, title: '', why, score: 0 };
}

/** The best section of one file for the question, or the whole file when nothing in it ranks. */
function bestSection(
  corpus: KnowledgeCorpus,
  terms: KnowledgeTerms,
  weights: TermWeights,
  document: KnowledgeDocument,
  why: string,
): Pick {
  const [hit] = rankChunks(corpus, terms, {
    limit: 1,
    weights,
    accept: (other) => other === document,
  });
  return hit === undefined || document.lines.length < 80
    ? wholeFile(document, why)
    : pick(hit, why);
}

/** `task`: the files that govern a piece of work, from the root index down to the rule and skill files. */
export function taskKnowledge(corpus: KnowledgeCorpus, description: string): string {
  const terms = termsOf(description);
  if (terms.words.length === 0 && terms.phrases.length === 0) {
    throw new Error('knowledge.context task needs a "description" with some words to match.');
  }
  const weights = termWeights(corpus, terms);
  const root = primaryRoot(corpus);
  const rootHits =
    root === undefined
      ? []
      : rankChunks(corpus, terms, {
          limit: 3,
          perFile: 3,
          weights,
          accept: (other) => other === root,
        });
  const boost = linkedFromRoot(corpus, rootHits);
  const everything = rankChunks(corpus, terms, { limit: 600, perFile: 1, boost, weights });
  const rules = bestPerFile(everything, 'rule').slice(0, 6);
  const always = corpus.documents.find(
    (document) =>
      document.file.kind === 'rule' &&
      document.file.path.includes('non-negotiable') &&
      !rules.some((entry) => entry.document === document),
  );
  const local = localInstructions(corpus, terms).map((document) =>
    bestSection(
      corpus,
      terms,
      weights,
      document,
      pathScore(document.file.path, terms).matched.join(', '),
    ),
  );
  const docs = [...bestPerFile(everything, 'doc'), ...bestPerFile(everything, 'context')]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const sections: Sections = {
    root: rootHits.map((hit) => pick(hit, hit.matched.slice(0, 3).join(', '))),
    rules: [...rules, ...(always === undefined ? [] : [wholeFile(always, 'always: the blockers')])],
    skills: bestPerFile(everything, 'skill').slice(0, 4),
    local,
    docs,
  };
  return trimTo(sections, { description, terms, weights, partial: corpus.partial });
}
