import { compileGlobMatcher } from './knowledge-glob-match';

import type { GlobMatcher } from './knowledge-glob-match';

/** Rules kept per workspace and the longest line read; a hostile .gitignore cannot grow the stack without bound. */
const MAX_RULES = 5_000;
const MAX_LINE = 1_024;

/** One .gitignore line, compiled. */
interface IgnoreRule {
  readonly base: string;
  readonly matcher: GlobMatcher;
  readonly anchored: boolean;
  readonly negate: boolean;
  readonly directoryOnly: boolean;
}

/** The .gitignore rules seen so far; deeper files are added as the walk enters their directory. */
export interface IgnoreStack {
  /** Adds the rules of the .gitignore in `directory` (workspace-relative, '' for the root). */
  add(directory: string, text: string): void;
  /** Whether git would ignore this workspace-relative path. */
  ignored(relativePath: string, isDirectory: boolean): boolean;
}

function compileLine(line: string, base: string): IgnoreRule | undefined {
  let text = line
    .slice(0, MAX_LINE)
    .replace(/\r$/u, '')
    .replace(/(?<!\\)\s+$/u, '');
  if (text.length === 0 || text.startsWith('#')) return undefined;
  const negate = text.startsWith('!');
  if (negate) text = text.slice(1);
  const directoryOnly = text.endsWith('/');
  if (directoryOnly) text = text.slice(0, -1);
  const anchored = text.startsWith('/') || text.includes('/');
  if (text.startsWith('/')) text = text.slice(1);
  if (text.length === 0) return undefined;
  return { base, matcher: compileGlobMatcher(text), anchored, negate, directoryOnly };
}

/** An empty stack; `add` the root .gitignore first. */
export function createIgnoreStack(): IgnoreStack {
  const rules: IgnoreRule[] = [];
  return {
    add: (directory, text) => {
      for (const line of text.split('\n')) {
        const rule = compileLine(line, directory);
        if (rule !== undefined && rules.length < MAX_RULES) rules.push(rule);
      }
    },
    ignored: (relativePath, isDirectory) => {
      let result = false;
      for (const rule of rules) {
        if (rule.directoryOnly && !isDirectory) continue;
        const prefix = rule.base.length === 0 ? '' : `${rule.base}/`;
        if (!relativePath.startsWith(prefix)) continue;
        if (rule.matcher.test(relativePath.slice(prefix.length), !rule.anchored))
          result = !rule.negate;
      }
      return result;
    },
  };
}
