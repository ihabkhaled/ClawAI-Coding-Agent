import type { DEPENDENCY_SCANNERS } from './dependency-audit.constants';

export type DependencyScanner = (typeof DEPENDENCY_SCANNERS)[number];

/** What a scanner is run as, before a workspace root is attached. */
export interface DependencyAuditCommand {
  readonly scanner: DependencyScanner;
  readonly executable: string;
  readonly arguments: readonly string[];
  /** The workspace-relative file findings are recorded against. */
  readonly manifest: string;
}

/** One vulnerable package, whatever scanner reported it. */
export interface DependencyAdvisory {
  readonly packageName: string;
  readonly version?: string;
  readonly ids: readonly string[];
  readonly summary: string;
  readonly severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  /** False when the scanner gave no severity and the default was applied. */
  readonly severityKnown: boolean;
  readonly fixedIn?: string;
  readonly manifest: string;
}
