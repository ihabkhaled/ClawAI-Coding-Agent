import { realpathSync } from 'node:fs';
import path from 'node:path';

import { redactText } from '../core/redaction';

import { createKnowledgeSource } from './knowledge-corpus';
import { indexKnowledge } from './knowledge-index';
import { readKnowledge } from './knowledge-read';
import { integerArgument, withoutHidden } from './knowledge-sanitize';
import { rankChunks, snippetOf, termWeights, termsOf } from './knowledge-search';
import { taskKnowledge } from './knowledge-task';
import {
  KNOWLEDGE_QUERY_MAX_CHARS,
  KNOWLEDGE_SEARCH_DEFAULT_HITS,
  KNOWLEDGE_SEARCH_MAX_CHARS,
  KNOWLEDGE_SEARCH_MAX_HITS,
  KNOWLEDGE_SNIPPET_CHARS,
  KNOWLEDGE_TASK_MAX_DESCRIPTION,
  KNOWLEDGE_TOOL_NAME,
  KNOWLEDGE_TOOL_OPERATIONS,
  KNOWLEDGE_UNTRUSTED_NOTICE,
} from './knowledge-tool.constants';

import type { KnowledgeCorpus, KnowledgeTool } from './knowledge-tool.types';

type Args = Readonly<Record<string, unknown>>;

function text(value: unknown, name: string, limit: number): string {
  const given = typeof value === 'string' ? value.trim() : '';
  if (given.length === 0) {
    throw new Error(`${KNOWLEDGE_TOOL_NAME} needs a non-empty "${name}".`);
  }
  if (given.length > limit) {
    throw new Error(`${KNOWLEDGE_TOOL_NAME}: "${name}" holds at most ${String(limit)} characters.`);
  }
  return given;
}

function searchKnowledge(corpus: KnowledgeCorpus, args: Args): string {
  const query = text(args.query, 'query', KNOWLEDGE_QUERY_MAX_CHARS);
  const requested = integerArgument(args.limit) ?? KNOWLEDGE_SEARCH_DEFAULT_HITS;
  const limit = Math.min(Math.max(requested, 1), KNOWLEDGE_SEARCH_MAX_HITS);
  const terms = termsOf(query);
  if (terms.words.length === 0 && terms.phrases.length === 0) {
    throw new Error(`${KNOWLEDGE_TOOL_NAME} search: give some words to look for.`);
  }
  const weights = termWeights(corpus, terms);
  const hits = rankChunks(corpus, terms, { limit, weights });
  if (hits.length === 0) {
    return `No knowledge section matches "${query.slice(0, 80)}". Try other words, or index to see what exists.`;
  }
  const rows: string[] = [];
  let used = 0;
  for (const [index, hit] of hits.entries()) {
    const heading = hit.chunk.title === '(start)' ? '' : ` "${hit.chunk.trail || hit.chunk.title}"`;
    const row = `${String(index + 1)}. ${hit.document.file.path}:${String(hit.chunk.startLine)}-${String(hit.chunk.endLine)}${heading}\n   ${snippetOf(hit, terms, KNOWLEDGE_SNIPPET_CHARS, weights)}`;
    if (used + row.length > KNOWLEDGE_SEARCH_MAX_CHARS && rows.length > 0) break;
    rows.push(row);
    used += row.length + 1;
  }
  const note = corpus.partial
    ? '\n(corpus cut at its byte limit: some files were not searched)'
    : '';
  return `${String(rows.length)} best sections for "${query.slice(0, 80)}":\n${rows.join('\n')}${note}`;
}

/**
 * The `knowledge.context` tool over one workspace.
 *
 * Everything it returns is repository text, so it is marked as such, passed
 * through redaction, and bounded; nothing it reads can change what the agent
 * is permitted to do, because permissions are decided by the toolkit and the
 * caller and this tool has no way to touch either.
 */
export function createKnowledgeTool(
  workspaceRoot: string,
  now: () => number = Date.now,
): KnowledgeTool {
  const workspace = (() => {
    try {
      return realpathSync(path.resolve(workspaceRoot));
    } catch {
      return path.resolve(workspaceRoot);
    }
  })();
  const source = createKnowledgeSource(workspace, now);
  return {
    execute: (operation, args, signal) => {
      if (KNOWLEDGE_TOOL_OPERATIONS[operation] === undefined) {
        throw new Error(
          `${KNOWLEDGE_TOOL_NAME} has no operation "${operation}"; use ${Object.keys(KNOWLEDGE_TOOL_OPERATIONS).join(', ')}.`,
        );
      }
      let body: string;
      if (operation === 'index') body = indexKnowledge(source.listing(signal), args.prefix);
      else if (operation === 'read') body = readKnowledge(workspace, args);
      else if (operation === 'search')
        body = redactText(withoutHidden(searchKnowledge(source.corpus(signal), args)));
      else {
        const description = text(args.description, 'description', KNOWLEDGE_TASK_MAX_DESCRIPTION);
        body = redactText(withoutHidden(taskKnowledge(source.corpus(signal), description)));
      }
      return `${KNOWLEDGE_UNTRUSTED_NOTICE}\n${withoutHidden(body)}`;
    },
  };
}
