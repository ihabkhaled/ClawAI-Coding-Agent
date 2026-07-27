const alwaysSensitivePattern =
  /(?:^|\/)(?:\.env(?:\.|$)|[^/]*(?:secret|credential|api[-_]?key)[^/]*)/iu;

export interface ContextCandidate {
  path: string;
  content: string;
}

export interface ContextCollectionOptions {
  exclude: string[];
  maxBytes: number;
  maxFiles: number;
}

export type ExclusionReason = 'binary' | 'excluded' | 'limit' | 'sensitive';

export interface ContextReceipt {
  included: string[];
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

function globToRegExp(glob: string): RegExp {
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

function normalizedPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\/+/u, '');
}

function isBinaryContent(content: string): boolean {
  return content.includes('\0');
}

export function collectContext(
  candidates: ContextCandidate[],
  options: ContextCollectionOptions,
): CollectedContext {
  const excludePatterns = options.exclude.map(globToRegExp);
  const excluded: ContextReceipt['excluded'] = [];
  const eligible: ContextCandidate[] = [];

  for (const candidate of candidates) {
    const path = normalizedPath(candidate.path);
    if (alwaysSensitivePattern.test(path)) {
      excluded.push({ path, reason: 'sensitive' });
    } else if (isBinaryContent(candidate.content)) {
      excluded.push({ path, reason: 'binary' });
    } else if (excludePatterns.some((pattern) => pattern.test(path))) {
      excluded.push({ path, reason: 'excluded' });
    } else {
      eligible.push({ path, content: candidate.content });
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
      included: files.map((file) => file.path),
      excluded,
      totalBytes,
      truncated: excluded.some((entry) => entry.reason === 'limit'),
    },
  };
}
