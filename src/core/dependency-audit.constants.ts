/**
 * How many dependency advisories one audit may record.
 *
 * The same reasoning as the SARIF cap: a findings list is triaged by a person,
 * and a monorepo audit that arrives with nine hundred transitive advisories is
 * not triaged at all. The parser sorts worst first, so the cap keeps the ones
 * that matter.
 */
export const MAX_DEPENDENCY_FINDINGS = 200;

/** One scanner run: long enough for a cold registry lookup, never a stuck window. */
export const DEPENDENCY_AUDIT_TIMEOUT_MS = 180_000;

/** A monorepo `npm audit --json` is a few megabytes; past this it is not parsed. */
export const DEPENDENCY_AUDIT_OUTPUT_BYTES = 8 * 1024 * 1024;

/**
 * The scanners this extension knows how to run, in the order `auto` tries them.
 *
 * `osv-scanner` first because it reads every lockfile ecosystem at once; the
 * package-manager auditors after it, each only when its manifest exists.
 */
export const DEPENDENCY_SCANNERS = ['osv-scanner', 'npm', 'pip-audit'] as const;

/** The word each advisory database uses, mapped onto the findings scale. */
export const ADVISORY_SEVERITY_WORDS: Readonly<Record<string, string>> = {
  critical: 'critical',
  high: 'high',
  moderate: 'medium',
  medium: 'medium',
  low: 'low',
  info: 'info',
};

/**
 * Lockfiles and requirement files looked for at the workspace root.
 *
 * Lockfiles rather than manifests, because an advisory is about the version
 * that is installed, and only the lockfile says which one that is.
 */
export const DEPENDENCY_MANIFESTS = [
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'requirements.txt',
  'poetry.lock',
  'go.sum',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
] as const;
