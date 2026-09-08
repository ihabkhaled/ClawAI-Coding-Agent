import { isSensitiveWorkspacePath, normalizeWorkspacePath } from './workspace-path-policy';

export const DIAGNOSTIC_SEVERITIES = ['error', 'warning', 'information', 'hint'] as const;

export type DiagnosticSeverity = (typeof DIAGNOSTIC_SEVERITIES)[number];

export interface WorkspaceDiagnostic {
  /** Workspace-relative, forward-slashed. */
  readonly path: string;
  /** One-based, to match what an editor and a compiler both report. */
  readonly line: number;
  readonly column: number;
  readonly severity: DiagnosticSeverity;
  /** The analyzer that produced it: `ts`, `eslint`. Absent when unreported. */
  readonly source?: string;
  readonly code?: string;
  readonly message: string;
}

export interface DiagnosticsQuery {
  /** Restrict to one file or one directory prefix. Absent means every file. */
  readonly path?: string;
  readonly minimumSeverity: DiagnosticSeverity;
  readonly maxResults: number;
}

export interface DiagnosticsSelection {
  readonly diagnostics: readonly WorkspaceDiagnostic[];
  /** Matching the query before the cap, so a capped answer is still countable. */
  readonly total: number;
  readonly truncated: boolean;
  readonly counts: Readonly<Record<DiagnosticSeverity, number>>;
}

const severityRank = new Map<DiagnosticSeverity, number>(
  DIAGNOSTIC_SEVERITIES.map((severity, index) => [severity, index]),
);

function rank(severity: DiagnosticSeverity): number {
  return severityRank.get(severity) ?? DIAGNOSTIC_SEVERITIES.length;
}

/**
 * Diagnostics the model may be shown, in the order it should read them.
 *
 * Two filters here are boundaries rather than conveniences. The editor reports
 * problems for every open document, including files the user opened from
 * outside the workspace, so paths are required to be workspace-relative before
 * anything is emitted — a diagnostic message quotes source, and an absolute
 * path from somewhere else is content this tool was never granted. The second
 * is the credential-name policy: a parse error in `.env` would otherwise put a
 * line of it in the message, which is exactly the read every other path into
 * the product refuses.
 *
 * Ordering is severity first, then path and line. A truncated list that begins
 * with hints and never reaches the errors is worse than no list, because it
 * reads as if the errors are not there.
 */
export function selectDiagnostics(
  all: readonly WorkspaceDiagnostic[],
  query: DiagnosticsQuery,
): DiagnosticsSelection {
  const ceiling = rank(query.minimumSeverity);
  const prefix = query.path === undefined ? undefined : normalizeWorkspacePath(query.path);
  const matching = all
    .filter((diagnostic) => {
      const path = normalizeWorkspacePath(diagnostic.path);
      if (path.length === 0 || path.startsWith('/') || path.split('/').includes('..')) return false;
      if (isSensitiveWorkspacePath(path)) return false;
      if (rank(diagnostic.severity) > ceiling) return false;
      if (prefix === undefined || prefix.length === 0) return true;
      return path === prefix || path.startsWith(`${prefix}/`);
    })
    .sort(
      (left, right) =>
        rank(left.severity) - rank(right.severity) ||
        left.path.localeCompare(right.path) ||
        left.line - right.line ||
        left.column - right.column,
    );

  const counts = Object.fromEntries(
    DIAGNOSTIC_SEVERITIES.map((severity) => [
      severity,
      matching.filter((diagnostic) => diagnostic.severity === severity).length,
    ]),
  ) as Record<DiagnosticSeverity, number>;

  return {
    diagnostics: matching.slice(0, query.maxResults),
    total: matching.length,
    truncated: matching.length > query.maxResults,
    counts,
  };
}
