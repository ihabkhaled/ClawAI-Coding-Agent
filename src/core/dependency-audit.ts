import { z } from 'zod';

import { ADVISORY_SEVERITY_WORDS, MAX_DEPENDENCY_FINDINGS } from './dependency-audit.constants';
import { FINDING_SEVERITIES, findingSchema, type Finding, type FindingSeverity } from './findings';
import { SECURITY_SEVERITY_BANDS } from './sarif.constants';

import type {
  DependencyAdvisory,
  DependencyAuditCommand,
  DependencyScanner,
} from './dependency-audit.types';

/**
 * The command for a scanner, given which manifests the workspace root has.
 *
 * Every auditor exits non-zero when it finds something, so the exit code is not
 * the result: the JSON on stdout is. `pip-audit` runs only against a
 * requirements file, because without one it audits whatever interpreter is on
 * PATH, which is a report about the developer's machine and not this project.
 */
export function dependencyAuditCommand(
  scanner: DependencyScanner,
  manifests: ReadonlySet<string>,
): DependencyAuditCommand | undefined {
  if (manifests.size === 0) return undefined;
  if (scanner === 'osv-scanner') {
    return {
      scanner,
      executable: 'osv-scanner',
      arguments: ['--format', 'json', '--recursive', '.'],
      manifest: firstPresent(manifests, ['package-lock.json', 'requirements.txt', 'go.sum']),
    };
  }
  if (scanner === 'npm') {
    if (!manifests.has('package-lock.json')) return undefined;
    return {
      scanner,
      executable: 'npm',
      arguments: ['audit', '--json'],
      manifest: 'package-lock.json',
    };
  }
  if (!manifests.has('requirements.txt')) return undefined;
  return {
    scanner,
    executable: 'pip-audit',
    arguments: ['--format', 'json', '--requirement', 'requirements.txt'],
    manifest: 'requirements.txt',
  };
}

function firstPresent(manifests: ReadonlySet<string>, candidates: readonly string[]): string {
  return (
    candidates.find((candidate) => manifests.has(candidate)) ??
    [...manifests].sort((left, right) => left.localeCompare(right))[0] ??
    '.'
  );
}

function wordSeverity(word: unknown): FindingSeverity | undefined {
  if (typeof word !== 'string') return undefined;
  const mapped = ADVISORY_SEVERITY_WORDS[word.trim().toLowerCase()];
  return FINDING_SEVERITIES.find((severity) => severity === mapped);
}

/** A CVSS-style score banded the way the SARIF import bands it. */
function scoreSeverity(score: unknown): FindingSeverity | undefined {
  const value = typeof score === 'string' ? Number.parseFloat(score) : score;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return SECURITY_SEVERITY_BANDS.find((band) => value >= band.atLeast)?.severity ?? 'info';
}

const npmViaSchema = z.object({ title: z.string().optional(), url: z.string().optional() }).loose();
const npmAuditSchema = z
  .object({
    vulnerabilities: z.record(
      z.string(),
      z
        .object({
          severity: z.string(),
          range: z.string().optional(),
          via: z.array(z.union([z.string(), npmViaSchema])).default([]),
          fixAvailable: z
            .union([z.boolean(), z.object({ version: z.string().optional() }).loose()])
            .optional(),
        })
        .loose(),
    ),
  })
  .loose();

/**
 * `npm audit --json`, audit report version 2.
 *
 * A package vulnerable only through another one lists that package's name as a
 * string in `via`; it is still reported, because the fix is often on the
 * direct dependency, and the summary says where it came from.
 */
export function advisoriesFromNpmAudit(json: unknown, manifest: string): DependencyAdvisory[] {
  const parsed = npmAuditSchema.safeParse(json);
  if (!parsed.success) return [];
  return Object.entries(parsed.data.vulnerabilities).map(([packageName, entry]) => {
    const direct = entry.via.filter((via) => typeof via !== 'string');
    const through = entry.via.filter((via): via is string => typeof via === 'string');
    const severity = wordSeverity(entry.severity);
    const fix = entry.fixAvailable;
    const title = direct.map((via) => via.title).find((candidate) => candidate !== undefined);
    return {
      packageName,
      ids: direct.flatMap((via) => (via.url === undefined ? [] : [via.url])),
      summary: title ?? `Vulnerable through ${through.join(', ') || 'a dependency'}`,
      severity: severity ?? 'medium',
      severityKnown: severity !== undefined,
      ...(typeof fix === 'object' && fix.version !== undefined ? { fixedIn: fix.version } : {}),
      ...(entry.range === undefined ? {} : { version: entry.range }),
      manifest,
    };
  });
}

const pipDependencySchema = z
  .object({
    name: z.string(),
    version: z.string().optional(),
    vulns: z
      .array(
        z
          .object({
            id: z.string(),
            fix_versions: z.array(z.string()).default([]),
            aliases: z.array(z.string()).default([]),
            description: z.string().optional(),
          })
          .loose(),
      )
      .default([]),
  })
  .loose();
const pipAuditSchema = z.union([
  z.object({ dependencies: z.array(pipDependencySchema) }).loose(),
  z.array(pipDependencySchema),
]);

/**
 * `pip-audit --format json`, both the current object and the older bare array.
 *
 * pip-audit reports no severity at all. Medium is recorded and the detail says
 * the scanner gave none, rather than inventing a score it never produced.
 */
export function advisoriesFromPipAudit(json: unknown, manifest: string): DependencyAdvisory[] {
  const parsed = pipAuditSchema.safeParse(json);
  if (!parsed.success) return [];
  const dependencies = Array.isArray(parsed.data) ? parsed.data : parsed.data.dependencies;
  return dependencies.flatMap((dependency) =>
    dependency.vulns.map((vuln) => ({
      packageName: dependency.name,
      ...(dependency.version === undefined ? {} : { version: dependency.version }),
      ids: [vuln.id, ...vuln.aliases],
      summary: (vuln.description ?? vuln.id).split('\n')[0] ?? vuln.id,
      severity: 'medium' as const,
      severityKnown: false,
      ...(vuln.fix_versions[0] === undefined ? {} : { fixedIn: vuln.fix_versions[0] }),
      manifest,
    })),
  );
}

const osvVulnerabilitySchema = z
  .object({
    id: z.string(),
    summary: z.string().optional(),
    aliases: z.array(z.string()).default([]),
    database_specific: z.object({ severity: z.unknown().optional() }).loose().optional(),
  })
  .loose();
const osvGroupSchema = z.object({ ids: z.array(z.string()), max_severity: z.unknown() }).loose();
const osvPackageSchema = z
  .object({
    package: z.object({ name: z.string(), version: z.string().optional() }).loose(),
    vulnerabilities: z.array(osvVulnerabilitySchema).default([]),
    groups: z.array(osvGroupSchema).default([]),
  })
  .loose();
const osvSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            source: z.object({ path: z.string() }).loose(),
            packages: z.array(osvPackageSchema).default([]),
          })
          .loose(),
      )
      .default([]),
  })
  .loose();

function osvAdvisories(
  entry: z.infer<typeof osvPackageSchema>,
  manifest: string,
): DependencyAdvisory[] {
  return entry.vulnerabilities.map((vuln) => {
    const group = entry.groups.find((candidate) => candidate.ids.includes(vuln.id));
    const severity =
      scoreSeverity(group?.max_severity) ?? wordSeverity(vuln.database_specific?.severity);
    return {
      packageName: entry.package.name,
      ...(entry.package.version === undefined ? {} : { version: entry.package.version }),
      ids: [vuln.id, ...vuln.aliases],
      summary: vuln.summary ?? vuln.id,
      severity: severity ?? 'medium',
      severityKnown: severity !== undefined,
      manifest,
    };
  });
}

/**
 * `osv-scanner --format json`.
 *
 * Source paths are absolute. `relativize` maps one into the workspace and
 * returns nothing for a lockfile outside it, which is dropped for the same
 * reason the SARIF import drops an unplaceable result: a finding at a guessed
 * path teaches the reader to distrust every other entry.
 */
export function advisoriesFromOsvScanner(
  json: unknown,
  relativize: (path: string) => string | undefined,
): DependencyAdvisory[] {
  const parsed = osvSchema.safeParse(json);
  if (!parsed.success) return [];
  return parsed.data.results.flatMap((result) => {
    const manifest = relativize(result.source.path);
    if (manifest === undefined) return [];
    return result.packages.flatMap((entry) => osvAdvisories(entry, manifest));
  });
}

function advisoryFinding(
  advisory: DependencyAdvisory,
  scanner: DependencyScanner,
): Finding | undefined {
  const version = advisory.version === undefined ? '' : `@${advisory.version}`;
  const ids = advisory.ids.length === 0 ? '' : ` (${advisory.ids.slice(0, 5).join(', ')})`;
  const unscored = advisory.severityKnown ? '' : ' The scanner reported no severity.';
  const parsed = findingSchema.safeParse({
    title: `${advisory.packageName}${version}: ${advisory.summary}`.slice(0, 200),
    severity: advisory.severity,
    // A matching advisory says the version is affected, not that the
    // vulnerable code is reachable from this project.
    confidence: 'medium',
    path: advisory.manifest,
    detail: `Known advisory for ${advisory.packageName}${version}${ids}.${unscored}`.slice(
      0,
      4_000,
    ),
    remediation:
      advisory.fixedIn === undefined
        ? `No fixed version is published. Check whether ${advisory.packageName} is reachable, then pin, patch or replace it.`
        : `Upgrade ${advisory.packageName} to ${advisory.fixedIn} or later.`,
    source: scanner,
  });
  return parsed.success ? parsed.data : undefined;
}

function rank(finding: Finding): number {
  return FINDING_SEVERITIES.indexOf(finding.severity);
}

/** Advisories as findings, worst first, capped for a person to triage. */
export function dependencyFindings(
  advisories: readonly DependencyAdvisory[],
  scanner: DependencyScanner,
): Finding[] {
  return advisories
    .map((advisory) => advisoryFinding(advisory, scanner))
    .filter((finding): finding is Finding => finding !== undefined)
    .sort((left, right) => rank(left) - rank(right))
    .slice(0, MAX_DEPENDENCY_FINDINGS);
}

/** The parser for a scanner's stdout, already decoded from JSON. */
export function advisoriesFor(
  scanner: DependencyScanner,
  json: unknown,
  manifest: string,
  relativize: (path: string) => string | undefined,
): DependencyAdvisory[] {
  if (scanner === 'npm') return advisoriesFromNpmAudit(json, manifest);
  if (scanner === 'pip-audit') return advisoriesFromPipAudit(json, manifest);
  return advisoriesFromOsvScanner(json, relativize);
}
