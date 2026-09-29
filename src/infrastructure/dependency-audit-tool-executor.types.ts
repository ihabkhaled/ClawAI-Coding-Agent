import type { DependencyAuditCommand } from '../core/dependency-audit.types';
import type { Finding } from '../core/findings';

/** What one scanner process returned, already bounded and redacted. */
export interface DependencyAuditOutput {
  readonly stdout: string;
  readonly timedOut: boolean;
  readonly truncated: boolean;
}

/** Running a dependency scanner in the workspace and recording what it found. */
export interface DependencyAuditPort {
  /** Which of the known manifest files exist at the workspace root. */
  manifests(): Promise<ReadonlySet<string>>;
  /** Whether the scanner's executable is on PATH. */
  available(executable: string): Promise<boolean>;
  /** Runs the command at the workspace root, bounded in time and output. */
  run(command: DependencyAuditCommand, signal?: AbortSignal): Promise<DependencyAuditOutput>;
  /** An absolute path as a workspace-relative one, or nothing outside the root. */
  relativize(path: string): string | undefined;
  /** Records the findings the way a reviewer's own report is recorded. */
  record(findings: readonly Finding[]): number;
}
