import {
  MAX_MULTILINE_MATCHES_PER_FILE,
  MAX_MULTILINE_SCAN_BYTES,
  SEARCH_FILE_TYPES,
} from './workspace-search-query.constants';

import type { MultilineSearchMatch } from './workspace-search-query.types';

const PREVIEW_CHARS = 500;

/**
 * Turns the type names a caller asked for into the extensions they cover.
 *
 * An unknown name is refused rather than ignored. Ignoring it would narrow the
 * search to nothing and report no matches, and a search that answers "not
 * found" when it never looked is the one failure mode that cannot be recovered
 * from downstream: the caller believes the workspace, not the tool.
 */
export function resolveFileTypeExtensions(types: readonly string[]): Set<string> {
  const extensions = new Set<string>();
  for (const raw of types) {
    const name = raw.trim().toLowerCase().replace(/^\./u, '');
    if (name.length === 0) {
      continue;
    }
    const known = SEARCH_FILE_TYPES[name];
    if (known === undefined) {
      // A bare extension is a legitimate answer, so only a name that is neither
      // a known type nor a plausible extension is an error.
      if (!/^[a-z0-9]+$/u.test(name)) {
        throw new Error(`unknown search file type: ${raw}`);
      }
      extensions.add(name);
      continue;
    }
    for (const extension of known) {
      extensions.add(extension);
    }
  }
  return extensions;
}

/** Whether a path is one of the extensions the caller scoped the search to. */
export function matchesFileTypes(path: string, extensions: ReadonlySet<string>): boolean {
  if (extensions.size === 0) {
    return true;
  }
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 && extensions.has(name.slice(dot + 1).toLowerCase());
}

/**
 * Compiles the query once, refusing a pattern the engine cannot run.
 *
 * A literal query is escaped rather than passed through, so a search for
 * `config.get(` keeps meaning those characters. `u` is deliberately omitted: it
 * would reject escapes a caller may reasonably write, and the alternative to a
 * usable regex here is the substring test this replaced.
 *
 * Multiline adds `s` so `.` reaches across a line break, `m` so `^` and `$`
 * still mean line boundaries, and `g` so one file can report more than its
 * first match. Without `s` a multiline search is just a slower per-line one.
 */
export function compileSearchMatcher(
  query: string,
  isRegex: boolean,
  ignoreCase: boolean,
  multiline = false,
): RegExp {
  const source = isRegex ? query : query.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  const flags = `${ignoreCase ? 'i' : ''}${multiline ? 'gms' : ''}`;
  try {
    return new RegExp(source, flags);
  } catch {
    throw new Error(
      'search regex is not valid; escape the pattern or pass regex: false for a literal query',
    );
  }
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 0x0a) {
      line += 1;
    }
  }
  return line;
}

/**
 * Where a pattern that spans lines matched, and what to show for it.
 *
 * The match is reported at the line it starts on, because that is the line a
 * reader would open. The preview is the matched text itself rather than the
 * starting line: a pattern written to span lines is asking about the span, and
 * showing only its first line would hide what was found.
 *
 * A zero-width match advances the cursor by hand. `lastIndex` does not move on
 * its own for an empty match, and the loop would never end.
 */
export function findMultilineMatches(text: string, matcher: RegExp): MultilineSearchMatch[] {
  const scanned = text.slice(0, MAX_MULTILINE_SCAN_BYTES);
  const matches: MultilineSearchMatch[] = [];
  matcher.lastIndex = 0;
  let found = matcher.exec(scanned);
  while (found !== null && matches.length < MAX_MULTILINE_MATCHES_PER_FILE) {
    matches.push({
      line: lineOf(scanned, found.index),
      preview: found[0].slice(0, PREVIEW_CHARS),
    });
    if (found[0].length === 0) {
      matcher.lastIndex += 1;
    }
    found = matcher.exec(scanned);
  }
  return matches;
}
