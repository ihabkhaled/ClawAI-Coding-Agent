import { contentDigest } from './context-freshness';
import { isSensitiveWorkspacePath, normalizeWorkspacePath } from './workspace-path-policy';

export interface ContextCandidate {
  path: string;
  content: string;
  /**
   * The 1-indexed, inclusive line range this candidate's content came from,
   * when it is less than the whole file — a selection or a `path:L-L`
   * reference. Absent means the candidate is the whole file.
   */
  startLine?: number;
  endLine?: number;
}

export interface ContextCollectionOptions {
  exclude: string[];
  maxBytes: number;
  maxFiles: number;
}

export type ExclusionReason = 'binary' | 'excluded' | 'limit' | 'sensitive';

export interface ContextInclusion {
  path: string;
  startLine?: number;
  endLine?: number;
  /**
   * A digest of exactly the text that was collected — the range, not the whole
   * file, because the range is what the reference names. Absent on a receipt
   * taken before digests existed.
   */
  digest?: string;
}

export interface ContextReceipt {
  included: ContextInclusion[];
  excluded: {
    path: string;
    reason: ExclusionReason;
  }[];
  totalBytes: number;
  truncated: boolean;
}

export interface CollectedContext {
  files: ContextCandidate[];
  receipt: ContextReceipt;
}

export function workspaceGlobToRegExp(glob: string): RegExp {
  let pattern = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    const next = glob[index + 1];
    if (character === '*' && next === '*') {
      const following = glob[index + 2];
      if (following === '/') {
        pattern += '(?:.*/)?';
        index += 2;
      } else {
        pattern += '.*';
        index += 1;
      }
    } else if (character === '*') {
      pattern += '[^/]*';
    } else if (character === '?') {
      pattern += '[^/]';
    } else if (character !== undefined) {
      pattern += character.replace(/[\\^$.[\]{}()+|]/gu, '\\$&');
    }
  }
  return new RegExp(`${pattern}$`, 'u');
}

function isBinaryContent(content: string): boolean {
  return content.includes('\0');
}

export function collectContext(
  candidates: ContextCandidate[],
  options: ContextCollectionOptions,
): CollectedContext {
  const excludePatterns = options.exclude.map(workspaceGlobToRegExp);
  const excluded: ContextReceipt['excluded'] = [];
  const eligible: ContextCandidate[] = [];

  for (const candidate of candidates) {
    const path = normalizeWorkspacePath(candidate.path);
    if (isSensitiveWorkspacePath(path)) {
      excluded.push({ path, reason: 'sensitive' });
    } else if (isBinaryContent(candidate.content)) {
      excluded.push({ path, reason: 'binary' });
    } else if (excludePatterns.some((pattern) => pattern.test(path))) {
      excluded.push({ path, reason: 'excluded' });
    } else {
      eligible.push({
        path,
        content: candidate.content,
        ...(candidate.startLine === undefined
          ? {}
          : { startLine: candidate.startLine, endLine: candidate.endLine }),
      });
    }
  }

  const files: ContextCandidate[] = [];
  let totalBytes = 0;
  for (const candidate of eligible) {
    const bytes = Buffer.byteLength(candidate.content, 'utf8');
    if (files.length >= options.maxFiles || totalBytes + bytes > options.maxBytes) {
      excluded.push({ path: candidate.path, reason: 'limit' });
      continue;
    }
    files.push(candidate);
    totalBytes += bytes;
  }

  return {
    files,
    receipt: {
      included: files.map((file) => ({
        path: file.path,
        ...(file.startLine === undefined
          ? {}
          : { startLine: file.startLine, endLine: file.endLine }),
        digest: contentDigest(file.content),
      })),
      excluded,
      totalBytes,
      truncated: excluded.some((entry) => entry.reason === 'limit'),
    },
  };
}

/**
 * Adds a second, already-collected batch — typically `path:L-L` references
 * pulled from the prompt text — onto a mode-collected one.
 *
 * A path already present in `base` is skipped rather than merged: it is
 * already sent in full or as the mode's own range, and a second, possibly
 * overlapping range for the same path would only inflate the payload for no
 * new information the model does not already have.
 */
export function mergeCollectedContext(
  base: CollectedContext,
  additional: CollectedContext,
): CollectedContext {
  const basePaths = new Set(base.files.map((file) => file.path));
  const newFiles = additional.files.filter((file) => !basePaths.has(file.path));
  const newIncluded = additional.receipt.included.filter((entry) => !basePaths.has(entry.path));
  const addedBytes = newFiles.reduce(
    (sum, file) => sum + Buffer.byteLength(file.content, 'utf8'),
    0,
  );
  return {
    files: [...base.files, ...newFiles],
    receipt: {
      included: [...base.receipt.included, ...newIncluded],
      excluded: [...base.receipt.excluded, ...additional.receipt.excluded],
      totalBytes: base.receipt.totalBytes + addedBytes,
      truncated: base.receipt.truncated || additional.receipt.truncated,
    },
  };
}
