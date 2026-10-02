import { compileGlob, normalizeGlob } from './write-scope';

/** Most wildcard tokens of one glob that are tried in every combination. */
const MAX_TOKENS = 6;

const WILDCARD = /[*?]/u;

/** What each wildcard stands for when a glob is instantiated: the shapes that matter to a matcher. */
const PROBES: Readonly<Record<string, readonly string[]>> = {
  '?': ['q'],
  '*': ['', 'q', '.q-'],
  '**/': ['', 'q/', 'q/q/'],
  '**': ['', 'q', 'q/q', 'q/q/q'],
};

function tokens(glob: string): readonly string[] {
  return glob.match(/\*\*\/|\*\*|\*|\?|[^*?]+/gu) ?? [];
}

function instances(glob: string): readonly string[] | undefined {
  const parts = tokens(glob);
  if (parts.filter((part) => WILDCARD.test(part)).length > MAX_TOKENS) return undefined;
  let found: readonly string[] = [''];
  for (const part of parts) {
    const options = PROBES[part] ?? [part];
    found = found.flatMap((prefix) => options.map((option) => prefix + option));
  }
  return found;
}

/**
 * Whether every path `child` can match is one `parents` match: each shape the
 * child's wildcards can take is tried against the parent globs. A glob too
 * complex to try is not accepted, so a doubt narrows rather than widens.
 */
export function globInsideAny(child: string, parents: readonly string[]): boolean {
  const glob = normalizeGlob(child);
  if (parents.some((parent) => normalizeGlob(parent) === glob)) return true;
  const shapes = instances(glob);
  if (shapes === undefined) return false;
  const matchers = parents.map((parent) => compileGlob(parent, true));
  return shapes.every((shape) => matchers.some((matcher) => matcher.test(shape)));
}

/** The first of `children` that is not inside `parents`, or undefined when all are. */
export function firstOutside(
  children: readonly string[],
  parents: readonly string[],
): string | undefined {
  return children.find((child) => !globInsideAny(child, parents));
}

function segments(glob: string): readonly string[] {
  return normalizeGlob(glob).toLowerCase().split('/');
}

function literalEdges(segment: string): { head: string; tail: string } {
  const first = segment.search(WILDCARD);
  const last = Math.max(segment.lastIndexOf('*'), segment.lastIndexOf('?'));
  return { head: segment.slice(0, first), tail: segment.slice(last + 1) };
}

/** Whether two segments, at least one with a wildcard, provably cannot match the same name. */
function segmentsDisjoint(left: string, right: string): boolean {
  if (!WILDCARD.test(left)) return !compileGlob(right, true).test(left);
  if (!WILDCARD.test(right)) return !compileGlob(left, true).test(right);
  const a = literalEdges(left);
  const b = literalEdges(right);
  const headsClash = !a.head.startsWith(b.head) && !b.head.startsWith(a.head);
  const tailsClash = !a.tail.endsWith(b.tail) && !b.tail.endsWith(a.tail);
  return headsClash || tailsClash;
}

/**
 * Whether two globs provably match no path in common. Segment by segment, up
 * to the first `**`; one clashing position is proof. Anything not proven is
 * treated as overlapping, so a doubt refuses a spawn rather than risking two
 * children writing the same file.
 */
export function globsDisjoint(left: string, right: string): boolean {
  const a = segments(left);
  const b = segments(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const x = a[index] ?? '';
    const y = b[index] ?? '';
    if (x === '**' || y === '**') return false;
    if (x === y) continue;
    if (segmentsDisjoint(x, y)) return true;
  }
  return false;
}

/** Whether two lists of globs can match a path in common. `undefined` means "anywhere". */
export function scopesOverlap(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  const a = left ?? ['**'];
  const b = right ?? ['**'];
  return a.some((x) => b.some((y) => !globsDisjoint(x, y)));
}

/**
 * The deny globs of a parent, as they read from inside a folder of it. A glob
 * that cannot reach the folder is dropped; one with `**` before the folder
 * is kept as written, because `**` matches the same from either root.
 */
export function rebaseGlobs(globs: readonly string[], folder: string): readonly string[] {
  if (folder.length === 0) return globs;
  const names = folder.split('/').filter((name) => name.length > 0);
  return globs.flatMap((glob) => {
    const parts = normalizeGlob(glob).split('/');
    for (const name of names) {
      const head = parts[0] ?? '';
      if (head === '**') return [parts.join('/')];
      if (!compileGlob(head, true).test(name)) return [];
      parts.shift();
    }
    return [parts.length === 0 ? '**' : parts.join('/')];
  });
}

/** `folder` and `glob` joined as a parent reads them. */
export function underFolder(folder: string, glob: string): string {
  const normal = normalizeGlob(glob);
  return folder.length === 0 ? normal : `${folder}/${normal}`;
}
