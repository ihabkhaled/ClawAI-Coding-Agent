/** What kind of knowledge a file is, decided from its path alone. */
export type KnowledgeKind =
  'instruction' | 'rule' | 'skill' | 'context' | 'doc' | 'memory' | 'ai' | 'other';

/** One knowledge file found by the bounded walk; never its content. */
export interface KnowledgeFile {
  /** Workspace-relative, with forward slashes. */
  readonly path: string;
  readonly bytes: number;
  readonly kind: KnowledgeKind;
}

/** What the bounded walk found and how far it got. */
export interface KnowledgeListing {
  readonly files: readonly KnowledgeFile[];
  readonly visited: number;
  /** True when a walk limit stopped it early: the list is a prefix, not everything. */
  readonly truncated: boolean;
}

/** A heading of a markdown file with where its section lies. */
export interface KnowledgeHeading {
  readonly level: number;
  readonly title: string;
  /** 1-indexed line of the heading itself. */
  readonly line: number;
}

/** A section of a file: from one heading to the next. Lines are 1-indexed and inclusive. */
export interface KnowledgeChunk {
  readonly title: string;
  /** The enclosing headings, outermost first, joined with " > ". */
  readonly trail: string;
  readonly level: number;
  readonly startLine: number;
  readonly endLine: number;
}

/** A file read and cut into chunks, with its text lowercased once for matching. */
export interface KnowledgeDocument {
  readonly file: KnowledgeFile;
  readonly lines: readonly string[];
  readonly chunks: readonly KnowledgeChunk[];
  readonly lowerChunks: readonly string[];
}

/** Every readable knowledge file of a workspace, chunked. */
export interface KnowledgeCorpus {
  readonly listing: KnowledgeListing;
  readonly documents: readonly KnowledgeDocument[];
  /** True when the byte budget stopped the reading before every file was loaded. */
  readonly partial: boolean;
}

/** One ranked chunk. */
export interface KnowledgeHit {
  readonly document: KnowledgeDocument;
  readonly chunk: KnowledgeChunk;
  readonly chunkIndex: number;
  readonly score: number;
  /** The query terms this chunk matched, for the "why". */
  readonly matched: readonly string[];
}

/** The words a question is searched by. */
export interface KnowledgeTerms {
  /** Single words, lowercase, stop words removed. */
  readonly words: readonly string[];
  /** Hyphen, underscore or dot joined names such as `chat-service`. */
  readonly phrases: readonly string[];
  /** The whole text lowercased, for contiguous phrase matches. */
  readonly raw: string;
}

/** The tool as the toolkit sees it. */
export interface KnowledgeTool {
  execute(operation: string, args: Readonly<Record<string, unknown>>, signal?: AbortSignal): string;
}
