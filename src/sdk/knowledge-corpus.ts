import { readFileSync } from 'node:fs';
import path from 'node:path';

import { chunksFor } from './knowledge-chunks';
import { listKnowledgeFiles } from './knowledge-files';
import {
  KNOWLEDGE_CACHE_TTL_MS,
  KNOWLEDGE_CORPUS_MAX_BYTES,
  KNOWLEDGE_CORPUS_PRIORITY,
  KNOWLEDGE_FILE_MAX_BYTES,
} from './knowledge-tool.constants';

import type {
  KnowledgeCorpus,
  KnowledgeDocument,
  KnowledgeFile,
  KnowledgeListing,
} from './knowledge-tool.types';

/** A file split into lines and chunks, or undefined when it cannot be read. */
export function loadDocument(
  workspace: string,
  file: KnowledgeFile,
): KnowledgeDocument | undefined {
  let text: string;
  try {
    text = readFileSync(path.join(workspace, file.path), 'utf8');
  } catch {
    return undefined;
  }
  const lines = text.split(/\r?\n/u);
  const chunks = chunksFor(file.path, lines);
  const lowerChunks = chunks.map((chunk) =>
    lines
      .slice(chunk.startLine - 1, chunk.endLine)
      .join('\n')
      .toLowerCase(),
  );
  return { file, lines, chunks, lowerChunks };
}

/** Governing files first, then the rest, smaller before larger: the byte budget never costs a rule file. */
function byPriority(a: KnowledgeFile, b: KnowledgeFile): number {
  const order =
    KNOWLEDGE_CORPUS_PRIORITY.indexOf(a.kind) - KNOWLEDGE_CORPUS_PRIORITY.indexOf(b.kind);
  return order === 0 ? a.bytes - b.bytes : order;
}

/** Reads and chunks the listed files, smallest first, within the byte budget. */
export function buildCorpus(
  workspace: string,
  listing: KnowledgeListing,
  signal?: AbortSignal,
): KnowledgeCorpus {
  const documents: KnowledgeDocument[] = [];
  let used = 0;
  let partial = false;
  const candidates = listing.files.filter((file) => file.bytes <= KNOWLEDGE_FILE_MAX_BYTES);
  partial = candidates.length < listing.files.length;
  for (const file of [...candidates].sort(byPriority)) {
    signal?.throwIfAborted();
    if (used + file.bytes > KNOWLEDGE_CORPUS_MAX_BYTES) {
      partial = true;
      continue;
    }
    const document = loadDocument(workspace, file);
    if (document === undefined) continue;
    used += file.bytes;
    documents.push(document);
  }
  documents.sort((a, b) => (a.file.path < b.file.path ? -1 : 1));
  return { listing, documents, partial };
}

/** The walk and the corpus of one workspace, each computed once and reused for a short while. */
export interface KnowledgeSource {
  listing(signal?: AbortSignal): KnowledgeListing;
  corpus(signal?: AbortSignal): KnowledgeCorpus;
}

export function createKnowledgeSource(
  workspace: string,
  now: () => number = Date.now,
): KnowledgeSource {
  let listed: { at: number; value: KnowledgeListing } | undefined;
  let built: { at: number; value: KnowledgeCorpus } | undefined;
  const fresh = (at: number | undefined): boolean =>
    at !== undefined && now() - at < KNOWLEDGE_CACHE_TTL_MS;
  const listing = (signal?: AbortSignal): KnowledgeListing => {
    if (listed !== undefined && fresh(listed.at)) return listed.value;
    const value = listKnowledgeFiles(workspace, signal);
    listed = { at: now(), value };
    return value;
  };
  return {
    listing,
    corpus: (signal) => {
      if (built !== undefined && fresh(built.at)) return built.value;
      const value = buildCorpus(workspace, listing(signal), signal);
      built = { at: now(), value };
      return value;
    },
  };
}
