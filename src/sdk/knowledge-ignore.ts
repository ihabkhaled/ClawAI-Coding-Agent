/** One .gitignore line, compiled. */
interface IgnoreRule {
  readonly base: string;
  readonly regex: RegExp;
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

const SPECIALS = /[.+^${}()|\\]/gu;

function globBody(pattern: string): string {
  let out = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern.charAt(index);
    if (char === '*') {
      if (pattern.charAt(index + 1) === '*') {
        const slash = pattern.charAt(index + 2) === '/';
        out += slash ? '(?:.*/)?' : '.*';
        index += slash ? 2 : 1;
      } else out += '[^/]*';
    } else if (char === '?') out += '[^/]';
    else if (char === '[') {
      const close = pattern.indexOf(']', index + 2);
      if (close === -1) out += '\\[';
      else {
        out += `[${pattern.slice(index + 1, close).replace(/^!/u, '^')}]`;
        index = close;
      }
    } else out += char.replace(SPECIALS, '\\$&');
  }
  return out;
}

function compileLine(line: string, base: string): IgnoreRule | undefined {
  let text = line.replace(/\r$/u, '').replace(/(?<!\\)\s+$/u, '');
  if (text.length === 0 || text.startsWith('#')) return undefined;
  const negate = text.startsWith('!');
  if (negate) text = text.slice(1);
  const directoryOnly = text.endsWith('/');
  if (directoryOnly) text = text.slice(0, -1);
  const anchored = text.startsWith('/') || text.includes('/');
  if (text.startsWith('/')) text = text.slice(1);
  if (text.length === 0) return undefined;
  const body = globBody(text);
  const regex = new RegExp(anchored ? `^${body}$` : `(?:^|/)${body}$`, 'u');
  return { base, regex, negate, directoryOnly };
}

/** An empty stack; `add` the root .gitignore first. */
export function createIgnoreStack(): IgnoreStack {
  const rules: IgnoreRule[] = [];
  return {
    add: (directory, text) => {
      for (const line of text.split('\n')) {
        const rule = compileLine(line, directory);
        if (rule !== undefined) rules.push(rule);
      }
    },
    ignored: (relativePath, isDirectory) => {
      let result = false;
      for (const rule of rules) {
        if (rule.directoryOnly && !isDirectory) continue;
        const prefix = rule.base.length === 0 ? '' : `${rule.base}/`;
        if (!relativePath.startsWith(prefix)) continue;
        if (rule.regex.test(relativePath.slice(prefix.length))) result = !rule.negate;
      }
      return result;
    },
  };
}
