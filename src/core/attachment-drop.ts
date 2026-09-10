import { isSafeRelativeWorkspacePath, normalizeWorkspacePath } from './workspace-path-policy';

import type { DropPayload, DropResolution } from './attachment-drop.types';

const MAX_DROPPED_PATHS = 20;

/**
 * Turns a `file:` URI into a workspace-relative path, or refuses it.
 *
 * Everything outside the workspace is refused, and so is every scheme that is
 * not `file:`. An editor drag can carry `untitled:`, `vscode-remote:` and
 * `http:` URIs, and a mention resolved from one of those either reads a file
 * the user did not mean or reads nothing while looking like it worked.
 */
function relativePath(uri: string, workspaceRoot: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'file:') return undefined;
  const decoded = decodeURIComponent(parsed.pathname).replace(/^\/([A-Za-z]:)/u, '$1');
  const root = workspaceRoot.replace(/\\/gu, '/');
  const candidate = decoded.replace(/\\/gu, '/');
  if (!candidate.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return undefined;
  const relative = normalizeWorkspacePath(candidate.slice(root.length + 1));
  return isSafeRelativeWorkspacePath(relative) ? relative : undefined;
}

/**
 * What a drop on the composer means.
 *
 * Three outcomes, because a drag carries three different things. Real file data
 * — a drag from the desktop — is an attachment, and always was. A drag from the
 * editor or the explorer carries references instead, and until now the composer
 * ignored those entirely: dropping a file from the file tree did nothing at
 * all, which reads as a broken feature rather than an absent one.
 *
 * Shift is the difference between naming a file and reading it. A plain drop
 * mentions the file, which pulls its contents into the next request; holding
 * Shift inserts the path as text, which is what you want when the path is the
 * subject rather than the content — "rename this file", "why is this excluded".
 * Getting that backwards would make the cheap gesture the expensive one.
 */
export function resolveDrop(payload: DropPayload, workspaceRoot: string): DropResolution {
  if (payload.hasFiles) {
    return { intent: 'attach', paths: [], refused: [] };
  }
  const uris = payload.uriList
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (uris.length === 0) {
    return { intent: 'ignore', paths: [], refused: [] };
  }
  const paths: string[] = [];
  const refused: string[] = [];
  for (const uri of uris.slice(0, MAX_DROPPED_PATHS)) {
    const relative = relativePath(uri, workspaceRoot);
    if (relative === undefined) {
      refused.push(uri);
      continue;
    }
    if (!paths.includes(relative)) paths.push(relative);
  }
  if (paths.length === 0) {
    return { intent: 'ignore', paths: [], refused };
  }
  return { intent: payload.shiftKey ? 'path-only' : 'mention', paths, refused };
}

/**
 * The text a resolved drop inserts.
 *
 * A mention is written in the syntax the composer already parses, so a dropped
 * file and a typed `@path` reach the same place. Nothing here invents a second
 * way to name a file.
 */
export function dropInsertion(resolution: DropResolution): string {
  if (resolution.intent === 'mention') {
    return resolution.paths.map((path) => `@${path}`).join(' ');
  }
  if (resolution.intent === 'path-only') {
    return resolution.paths.join(' ');
  }
  return '';
}
