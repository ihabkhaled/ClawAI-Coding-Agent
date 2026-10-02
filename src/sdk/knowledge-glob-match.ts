/**
 * A .gitignore pattern matcher that runs in time proportional to the pattern
 * times the path, whatever the pattern looks like. A pattern compiled to a
 * regular expression backtracks without bound on `*a*a*a*a*b` against a long
 * run of `a`, and a repository's own .gitignore must never be able to hang the
 * agent. The pattern is a small automaton and every path is simulated through
 * all of its states at once.
 */

type Node =
  | { readonly kind: 'lit'; readonly char: string }
  | { readonly kind: 'one' }
  | { readonly kind: 'star' }
  | { readonly kind: 'any' }
  | { readonly kind: 'optional' }
  | { readonly kind: 'class'; readonly negated: boolean; readonly members: readonly Range[] };

type Range = readonly [number, number];

/** A compiled pattern. */
export interface GlobMatcher {
  /** Whether the whole of `text` matches the pattern, which must start at a path-segment start when `anywhere`. */
  test(text: string, anywhere: boolean): boolean;
}

/** The most pattern nodes kept; a longer pattern is cut, which only ever makes a rule match less. */
const MAX_NODES = 256;
/** The longest path tested; a longer one is treated as not matching. */
const MAX_TEXT = 4096;

function parseClass(pattern: string, open: number): { node: Node; end: number } | undefined {
  let index = open + 1;
  const negated = pattern.charAt(index) === '!' || pattern.charAt(index) === '^';
  if (negated) index += 1;
  const members: Range[] = [];
  const first = index;
  for (; index < pattern.length; index += 1) {
    const char = pattern.charAt(index);
    if (char === ']' && index > first)
      return { node: { kind: 'class', negated, members }, end: index };
    const code = char.codePointAt(0) ?? 0;
    if (
      pattern.charAt(index + 1) === '-' &&
      pattern.charAt(index + 2) !== ']' &&
      index + 2 < pattern.length
    ) {
      const upper = pattern.codePointAt(index + 2) ?? code;
      if (upper >= code) members.push([code, upper]);
      index += 2;
    } else members.push([code, code]);
  }
  return undefined;
}

/** Adds the node for the wildcard at `index`; returns the index of its last character. */
function pushWildcard(nodes: Node[], pattern: string, index: number): number {
  if (pattern.charAt(index) === '?') {
    nodes.push({ kind: 'one' });
    return index;
  }
  if (pattern.charAt(index + 1) !== '*') {
    if (nodes.at(-1)?.kind !== 'star') nodes.push({ kind: 'star' });
    return index;
  }
  let last = index + 1;
  while (pattern.charAt(last + 1) === '*') last += 1;
  if (pattern.charAt(last + 1) === '/') {
    nodes.push({ kind: 'optional' }, { kind: 'any' }, { kind: 'lit', char: '/' });
    return last + 1;
  }
  nodes.push({ kind: 'any' });
  return last;
}

/** Adds the node for an opening bracket at `index`; returns the index of its last character. */
function pushClass(nodes: Node[], pattern: string, index: number): number {
  const parsed = parseClass(pattern, index);
  if (parsed === undefined) {
    nodes.push({ kind: 'lit', char: '[' });
    return index;
  }
  nodes.push(parsed.node);
  return parsed.end;
}

function compile(pattern: string): readonly Node[] {
  const nodes: Node[] = [];
  for (let index = 0; index < pattern.length && nodes.length < MAX_NODES; index += 1) {
    const char = pattern.charAt(index);
    if (char === '*' || char === '?') index = pushWildcard(nodes, pattern, index);
    else if (char === '[') index = pushClass(nodes, pattern, index);
    else if (char === '\\' && index + 1 < pattern.length) {
      index += 1;
      nodes.push({ kind: 'lit', char: pattern.charAt(index) });
    } else nodes.push({ kind: 'lit', char });
  }
  return nodes;
}

function consumes(node: Node, char: string): boolean {
  switch (node.kind) {
    case 'lit':
      return node.char === char;
    case 'one':
    case 'star':
      return char !== '/';
    case 'any':
      return true;
    case 'class': {
      const code = char.codePointAt(0) ?? 0;
      const inside = node.members.some(([from, to]) => code >= from && code <= to);
      return char !== '/' && inside !== node.negated;
    }
    case 'optional':
      return false;
  }
}

/** Adds `state` and everything reachable from it without consuming a character. */
function close(nodes: readonly Node[], state: number, into: Set<number>): void {
  if (into.has(state)) return;
  into.add(state);
  const node = nodes[state];
  if (node === undefined) return;
  if (node.kind === 'star' || node.kind === 'any') close(nodes, state + 1, into);
  if (node.kind === 'optional') {
    close(nodes, state + 1, into);
    close(nodes, state + 3, into);
  }
}

/** Compiles a glob body (already stripped of its leading and trailing slash). */
export function compileGlobMatcher(pattern: string): GlobMatcher {
  const nodes = compile(pattern);
  return {
    test: (text, anywhere) => {
      if (text.length > MAX_TEXT) return false;
      let states = new Set<number>();
      close(nodes, 0, states);
      for (const char of text) {
        const next = new Set<number>();
        for (const state of states) {
          const node = nodes[state];
          if (node === undefined || !consumes(node, char)) continue;
          close(nodes, node.kind === 'star' || node.kind === 'any' ? state : state + 1, next);
        }
        if (anywhere && char === '/') close(nodes, 0, next);
        states = next;
        if (states.size === 0) return false;
      }
      return states.has(nodes.length);
    },
  };
}
