import path from 'node:path';

import {
  KNOWLEDGE_KIND_MULTIPLIER,
  KNOWLEDGE_MAX_TERMS,
  KNOWLEDGE_STOP_WORDS,
  KNOWLEDGE_WEIGHTS,
} from './knowledge-tool.constants';

import type {
  KnowledgeChunk,
  KnowledgeCorpus,
  KnowledgeDocument,
  KnowledgeHit,
  KnowledgeTerms,
} from './knowledge-tool.types';

/** Lines a snippet never is: blank, rules and table separators, headings, front matter fences. */
const UNHELPFUL_LINE = /^(?:[-|:\s]*|#{1,6}\s.*|```.*)$/u;
const SHELL_LINE = /^(?:\$|cd |npm |npx |git |docker |#\s)/u;
const SNIPPET_MIN_PROSE_CHARS = 30;
/** A line that states an obligation is what a snippet is for. */
const DIRECTIVE_LINE =
  /\b(?:must|never|always|required|mandatory|forbidden|ships?|same commit)\b/iu;
const PHRASE = /[a-z0-9]+(?:[-_.][a-z0-9]+)+/gu;
const WORD = /[a-z0-9]{2,}/gu;

/** A word cut to the part plural and verb endings do not change: `migrations` and `migrating` meet. */
export function stem(word: string): string {
  if (word.length <= 4) return word;
  for (const ending of ['ations', 'ation', 'ings', 'ing', 'ies', 'es', 'ed', 's']) {
    if (word.endsWith(ending) && word.length - ending.length >= 4) {
      return word.slice(0, word.length - ending.length);
    }
  }
  return word;
}

/** The searchable words of a question; stop words and repeats are dropped. */
export function termsOf(text: string): KnowledgeTerms {
  const raw = text.toLowerCase();
  const phrases = [...new Set(raw.match(PHRASE) ?? [])].filter((phrase) => phrase.length >= 5);
  const seen = new Set<string>();
  const words: string[] = [];
  for (const word of raw.match(WORD) ?? []) {
    const root = stem(word);
    if (KNOWLEDGE_STOP_WORDS.has(word) || seen.has(root)) continue;
    seen.add(root);
    words.push(root);
  }
  return {
    words: words.slice(0, KNOWLEDGE_MAX_TERMS),
    phrases: phrases.slice(0, 4),
    raw,
  };
}

function occurrences(haystack: string, needle: string, cap: number): number {
  let count = 0;
  for (
    let at = haystack.indexOf(needle);
    at !== -1 && count < cap;
    at = haystack.indexOf(needle, at + needle.length)
  ) {
    count += 1;
  }
  return count;
}

interface PathScore {
  readonly score: number;
  readonly matched: readonly string[];
}

/** How much each term is worth: a term found in few sections says more than one found everywhere. */
export type TermWeights = ReadonlyMap<string, number>;

/** Inverse-frequency weights over the chunks of the corpus, the rarest term worth 1. */
export function termWeights(corpus: KnowledgeCorpus, terms: KnowledgeTerms): TermWeights {
  const all = [...terms.words, ...terms.phrases];
  const document = new Map<string, number>(all.map((term) => [term, 0]));
  let chunks = 0;
  for (const entry of corpus.documents) {
    for (const body of entry.lowerChunks) {
      chunks += 1;
      for (const term of all)
        if (body.includes(term)) document.set(term, (document.get(term) ?? 0) + 1);
    }
  }
  const raw = all.map((term) => Math.log(1 + chunks / (1 + (document.get(term) ?? 0))));
  const top = Math.max(...raw, Number.EPSILON);
  return new Map(all.map((term, index) => [term, Math.max(0.08, (raw[index] ?? 0) / top)]));
}

const weightOf = (weights: TermWeights | undefined, term: string): number =>
  weights?.get(term) ?? 1;

/** How well a file's path names the terms: the cheapest and strongest signal. */
export function pathScore(file: string, terms: KnowledgeTerms, weights?: TermWeights): PathScore {
  const lower = file.toLowerCase();
  const name = path.posix.basename(lower);
  const matched: string[] = [];
  let score = 0;
  for (const word of terms.words) {
    const inName = name.includes(word);
    if (!inName && !lower.includes(word)) continue;
    score +=
      (inName ? KNOWLEDGE_WEIGHTS.pathWord : KNOWLEDGE_WEIGHTS.pathSubstring) *
      weightOf(weights, word);
    matched.push(word);
  }
  for (const phrase of terms.phrases) {
    if (!lower.includes(phrase)) continue;
    score += KNOWLEDGE_WEIGHTS.pathPhrase * weightOf(weights, phrase);
    matched.push(phrase);
  }
  return { score, matched };
}

interface ChunkContext {
  readonly terms: KnowledgeTerms;
  readonly weights: TermWeights;
  readonly fromPath: PathScore;
}

interface Scored {
  score: number;
  readonly matched: Set<string>;
}

/** Points for single words: counts in the body (less in a long section), plus the heading. */
function wordPoints(
  chunk: KnowledgeChunk,
  body: string,
  context: ChunkContext,
  into: Scored,
): void {
  const title = chunk.title.toLowerCase();
  const trail = chunk.trail.toLowerCase();
  // A long section mentions everything: its counts are worth less than a short section's.
  const lengthFactor = 1 / (1 + body.length / KNOWLEDGE_WEIGHTS.lengthScale);
  for (const word of context.terms.words) {
    const count = occurrences(body, word, KNOWLEDGE_WEIGHTS.bodyWordCap);
    let points = count * lengthFactor;
    if (title.includes(word)) points += KNOWLEDGE_WEIGHTS.headingWord;
    else if (trail.includes(word)) points += KNOWLEDGE_WEIGHTS.trailWord;
    if (count > 0 || points > 0) into.matched.add(word);
    into.score += points * weightOf(context.weights, word);
  }
}

/** Points for hyphenated names such as `chat-service`. */
function phrasePoints(
  chunk: KnowledgeChunk,
  body: string,
  context: ChunkContext,
  into: Scored,
): void {
  const title = chunk.title.toLowerCase();
  for (const phrase of context.terms.phrases) {
    const weight = weightOf(context.weights, phrase);
    if (title.includes(phrase)) into.score += KNOWLEDGE_WEIGHTS.headingPhrase * weight;
    if (body.includes(phrase)) {
      into.score += KNOWLEDGE_WEIGHTS.bodyPhrase * weight;
      into.matched.add(phrase);
    }
  }
}

/** The share of the question's weight that a chunk matched, squared so covering most terms wins. */
function coverageBonus(matched: ReadonlySet<string>, context: ChunkContext): number {
  const { terms, weights } = context;
  const total = [...terms.words, ...terms.phrases].reduce(
    (sum, term) => sum + weightOf(weights, term),
    0,
  );
  const found = [...matched].reduce((sum, term) => sum + weightOf(weights, term), 0);
  const share = total === 0 ? 0 : found / total;
  return share * share * KNOWLEDGE_WEIGHTS.coverage;
}

/** One chunk's score and the terms it matched; undefined when nothing matched. */
function scoreChunk(
  document: KnowledgeDocument,
  index: number,
  context: ChunkContext,
): KnowledgeHit | undefined {
  const chunk = document.chunks[index];
  const body = document.lowerChunks[index];
  if (chunk === undefined || body === undefined) return undefined;
  const scored: Scored = { score: 0, matched: new Set<string>() };
  wordPoints(chunk, body, context, scored);
  phrasePoints(chunk, body, context, scored);
  if (scored.matched.size === 0 && context.fromPath.score === 0) return undefined;
  scored.score += coverageBonus(scored.matched, context);
  for (const word of context.fromPath.matched) scored.matched.add(word);
  const multiplier = KNOWLEDGE_KIND_MULTIPLIER[document.file.kind];
  return {
    document,
    chunk,
    chunkIndex: index,
    score: (scored.score + context.fromPath.score) * multiplier,
    matched: [...scored.matched],
  };
}

/** Options for a ranking. */
export interface RankOptions {
  readonly limit: number;
  /** At most this many chunks from one file, so one long file cannot fill the answer. */
  readonly perFile?: number;
  /** Extra score per path, for files the root instruction file points at. */
  readonly boost?: ReadonlyMap<string, number>;
  /** Computed from the corpus when absent; pass them to rank several times without recounting. */
  readonly weights?: TermWeights | undefined;
  /** Only files for which this is true are ranked. */
  readonly accept?: (document: KnowledgeDocument) => boolean;
}

/** The best `limit` hits, taking at most `perFile` from one file. */
function topHits(
  sorted: readonly KnowledgeHit[],
  limit: number,
  perFile: number,
): readonly KnowledgeHit[] {
  const taken = new Map<string, number>();
  const result: KnowledgeHit[] = [];
  for (const hit of sorted) {
    const used = taken.get(hit.document.file.path) ?? 0;
    if (used >= perFile) continue;
    taken.set(hit.document.file.path, used + 1);
    result.push(hit);
    if (result.length >= limit) break;
  }
  return result;
}

/** The best chunks for a question, best first, deterministic. */
export function rankChunks(
  corpus: KnowledgeCorpus,
  terms: KnowledgeTerms,
  options: RankOptions,
): readonly KnowledgeHit[] {
  const hits: KnowledgeHit[] = [];
  const weights = options.weights ?? termWeights(corpus, terms);
  for (const document of corpus.documents) {
    if (options.accept?.(document) === false) continue;
    const fromPath = pathScore(document.file.path, terms, weights);
    const boost = options.boost?.get(document.file.path) ?? 0;
    for (let index = 0; index < document.chunks.length; index += 1) {
      const hit = scoreChunk(document, index, { terms, weights, fromPath });
      if (hit !== undefined) hits.push({ ...hit, score: hit.score + boost });
    }
  }
  hits.sort((a, b) =>
    b.score === a.score
      ? a.document.file.path.localeCompare(b.document.file.path) || a.chunkIndex - b.chunkIndex
      : b.score - a.score,
  );
  return topHits(hits, options.limit, options.perFile ?? 2);
}

/** The line of lines start..end (1-indexed) that matches the most terms, cut to `limit` characters. */
export function snippetIn(
  document: KnowledgeDocument,
  startLine: number,
  endLine: number,
  terms: KnowledgeTerms,
  limit: number,
  weights?: TermWeights,
): string {
  // Words, not names: a service name matches every line that mentions the service.
  const wanted = terms.words;
  let best = '';
  let bestScore = 0;
  for (let line = startLine; line <= endLine; line += 1) {
    const text = (document.lines[line - 1] ?? '').trim();
    if (UNHELPFUL_LINE.test(text)) continue;
    const lower = text.toLowerCase();
    let score = wanted
      .filter((term) => lower.includes(term))
      .reduce((sum, term) => sum + weightOf(weights, term), 0);
    // A sentence says more than a fragment or a shell line.
    if (text.length < SNIPPET_MIN_PROSE_CHARS || SHELL_LINE.test(text)) score *= 0.3;
    if (DIRECTIVE_LINE.test(text)) score *= 1.5;
    if (score > bestScore) {
      best = text;
      bestScore = score;
    }
  }
  return best.length > limit ? `${best.slice(0, limit - 1)}…` : best;
}

/** The line of a chunk that matches the most terms, cut to `limit` characters. */
export function snippetOf(
  hit: KnowledgeHit,
  terms: KnowledgeTerms,
  limit: number,
  weights?: TermWeights,
): string {
  return snippetIn(hit.document, hit.chunk.startLine, hit.chunk.endLine, terms, limit, weights);
}
