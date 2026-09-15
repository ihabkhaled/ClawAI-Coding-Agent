import { isSafeRelativeWorkspacePath, normalizeWorkspacePath } from './workspace-path-policy';

export const SYMBOL_QUERY_KINDS = ['definition', 'references', 'implementations'] as const;

export type SymbolQueryKind = (typeof SYMBOL_QUERY_KINDS)[number];

export function isSymbolQueryKind(value: string): value is SymbolQueryKind {
  return SYMBOL_QUERY_KINDS.some((kind) => kind === value);
}

export interface WorkspaceLocation {
  /** Workspace-relative, forward-slashed. */
  readonly path: string;
  /** One-based, matching what an editor and a compiler both report. */
  readonly line: number;
  readonly column: number;
  /** The line the location points at, trimmed. Absent when unreadable. */
  readonly preview?: string;
}

export interface LocationSelection {
  readonly locations: readonly WorkspaceLocation[];
  readonly total: number;
  readonly truncated: boolean;
}

/**
 * Locations the model may be shown, deduplicated and ordered.
 *
 * A language server answers about whatever it has open, which includes files
 * outside this workspace and, for a definition in a dependency, files the tool
 * was never granted. The path rule is the one every tool schema already
 * applies, so a result that could not be read through `workspace.files` cannot
 * arrive through this door either — and `preview` carries a line of source, so
 * it is a read in every sense that matters.
 *
 * Providers routinely return the same location more than once, once per
 * overload or re-export, so identical entries collapse. Order is by path, then
 * position, because a caller reading a capped list wants the file it asked
 * about first, not whichever provider answered fastest.
 */
export function selectLocations(
  all: readonly WorkspaceLocation[],
  maxResults: number,
): LocationSelection {
  const seen = new Set<string>();
  const matching: WorkspaceLocation[] = [];
  for (const location of all) {
    const path = normalizeWorkspacePath(location.path);
    if (!isSafeRelativeWorkspacePath(path)) continue;
    const key = `${path}:${String(location.line)}:${String(location.column)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matching.push({ ...location, path });
  }
  matching.sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.line - right.line || left.column - right.column,
  );
  return {
    locations: matching.slice(0, maxResults),
    total: matching.length,
    truncated: matching.length > maxResults,
  };
}
