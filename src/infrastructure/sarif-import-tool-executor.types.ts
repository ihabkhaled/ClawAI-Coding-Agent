import type { Finding } from '../core/findings';

/** Reading a scanner's report and recording what it found. */
export interface SarifImportPort {
  /** The file's text, or nothing when it cannot be read as a workspace file. */
  readReport(path: string): Promise<string | undefined>;
  /** Records the findings the way a reviewer's own report is recorded. */
  record(findings: readonly Finding[]): Promise<number>;
}
