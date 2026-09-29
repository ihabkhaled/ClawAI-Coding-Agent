import { describe, expect, it, vi } from 'vitest';

import { BUILT_IN_SKILLS } from '../../src/core/built-in-skills.constants';
import {
  advisoriesFor,
  advisoriesFromNpmAudit,
  advisoriesFromOsvScanner,
  advisoriesFromPipAudit,
  dependencyAuditCommand,
  dependencyFindings,
} from '../../src/core/dependency-audit';
import { MAX_DEPENDENCY_FINDINGS } from '../../src/core/dependency-audit.constants';
import {
  DependencyAuditToolExecutor,
  dependencyAuditToolDefinition,
} from '../../src/infrastructure/dependency-audit-tool-executor';
import { SkillCatalogService } from '../../src/services/skill-catalog-service';

import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';
import type { DependencyAuditPort } from '../../src/infrastructure/dependency-audit-tool-executor.types';

const npmReport = {
  auditReportVersion: 2,
  vulnerabilities: {
    lodash: {
      name: 'lodash',
      severity: 'high',
      range: '<4.17.21',
      via: [{ title: 'Prototype Pollution', url: 'https://github.com/advisories/GHSA-1', cwe: [] }],
      fixAvailable: { name: 'lodash', version: '4.17.21', isSemVerMajor: false },
    },
    wrapper: { severity: 'moderate', via: ['lodash'], fixAvailable: true },
    odd: { severity: 'catastrophic', via: [] },
  },
};

describe('dependencyAuditCommand', () => {
  const manifests = new Set(['package-lock.json']);

  it('runs osv-scanner recursively against the root', () => {
    expect(dependencyAuditCommand('osv-scanner', manifests)).toMatchObject({
      executable: 'osv-scanner',
      arguments: ['--format', 'json', '--recursive', '.'],
      manifest: 'package-lock.json',
    });
  });

  it('falls back to the first lockfile osv-scanner can name', () => {
    expect(
      dependencyAuditCommand('osv-scanner', new Set(['yarn.lock', 'Cargo.lock']))?.manifest,
    ).toBe('Cargo.lock');
  });

  it('runs npm audit only with a package lock', () => {
    expect(dependencyAuditCommand('npm', manifests)?.arguments).toEqual(['audit', '--json']);
    expect(dependencyAuditCommand('npm', new Set(['requirements.txt']))).toBeUndefined();
  });

  it('runs pip-audit only against a requirements file, never the interpreter on PATH', () => {
    expect(dependencyAuditCommand('pip-audit', manifests)).toBeUndefined();
    expect(dependencyAuditCommand('pip-audit', new Set(['requirements.txt']))?.arguments).toContain(
      'requirements.txt',
    );
  });

  it('runs nothing in a workspace with no lockfile', () => {
    expect(dependencyAuditCommand('osv-scanner', new Set())).toBeUndefined();
  });
});

describe('advisory parsers', () => {
  it('reads npm audit v2, including packages vulnerable only through another', () => {
    const advisories = advisoriesFromNpmAudit(npmReport, 'package-lock.json');
    expect(advisories[0]).toMatchObject({
      packageName: 'lodash',
      severity: 'high',
      fixedIn: '4.17.21',
      version: '<4.17.21',
      ids: ['https://github.com/advisories/GHSA-1'],
    });
    expect(advisories[1]).toMatchObject({
      summary: 'Vulnerable through lodash',
      severity: 'medium',
      severityKnown: true,
    });
    expect(advisories[2]).toMatchObject({ severity: 'medium', severityKnown: false });
  });

  it('returns nothing for output that is not an npm audit report', () => {
    expect(advisoriesFromNpmAudit({ error: 'ENOLOCK' }, 'package-lock.json')).toEqual([]);
  });

  it('reads both pip-audit shapes and records that it gives no severity', () => {
    const dependency = {
      name: 'flask',
      version: '0.5',
      vulns: [
        { id: 'PYSEC-1', fix_versions: ['1.0'], aliases: ['CVE-1'], description: 'Bad\nmore' },
      ],
    };
    const current = advisoriesFromPipAudit({ dependencies: [dependency] }, 'requirements.txt');
    const legacy = advisoriesFromPipAudit([dependency], 'requirements.txt');
    expect(current).toEqual(legacy);
    expect(current[0]).toMatchObject({
      ids: ['PYSEC-1', 'CVE-1'],
      summary: 'Bad',
      fixedIn: '1.0',
      severityKnown: false,
    });
    expect(advisoriesFromPipAudit('nope', 'requirements.txt')).toEqual([]);
  });

  it('reads osv-scanner, prefers the numeric score and drops lockfiles outside the workspace', () => {
    const report = {
      results: [
        {
          source: { path: '/repo/package-lock.json' },
          packages: [
            {
              package: { name: 'minimist', version: '1.2.0' },
              vulnerabilities: [
                { id: 'GHSA-a', summary: 'Pollution', database_specific: { severity: 'LOW' } },
                { id: 'GHSA-b', database_specific: { severity: 'MODERATE' } },
                { id: 'GHSA-c' },
              ],
              groups: [{ ids: ['GHSA-a'], max_severity: '9.8' }],
            },
          ],
        },
        { source: { path: '/elsewhere/go.sum' }, packages: [{ package: { name: 'x' } }] },
      ],
    };
    const relativize = (path: string): string | undefined =>
      path.startsWith('/repo/') ? path.slice('/repo/'.length) : undefined;
    const advisories = advisoriesFromOsvScanner(report, relativize);
    expect(advisories.map((advisory) => advisory.severity)).toEqual([
      'critical',
      'medium',
      'medium',
    ]);
    expect(advisories[2]?.severityKnown).toBe(false);
    expect(advisories.every((advisory) => advisory.manifest === 'package-lock.json')).toBe(true);
    expect(advisoriesFromOsvScanner(42, relativize)).toEqual([]);
  });

  it('dispatches each scanner to its own parser', () => {
    expect(advisoriesFor('npm', npmReport, 'package-lock.json', () => undefined)).toHaveLength(3);
    expect(advisoriesFor('pip-audit', [], 'requirements.txt', () => undefined)).toEqual([]);
    expect(advisoriesFor('osv-scanner', { results: [] }, 'x', () => undefined)).toEqual([]);
  });
});

describe('dependencyFindings', () => {
  it('produces medium-confidence findings, worst first, with a remediation', () => {
    const findings = dependencyFindings(
      advisoriesFromNpmAudit(npmReport, 'package-lock.json'),
      'npm',
    );
    expect(findings[0]).toMatchObject({
      severity: 'high',
      confidence: 'medium',
      path: 'package-lock.json',
      source: 'npm',
      remediation: 'Upgrade lodash to 4.17.21 or later.',
    });
    expect(findings.at(-1)?.detail).toContain('no severity');
    expect(findings[1]?.remediation).toContain('No fixed version is published');
  });

  it('caps what one audit can record, keeping the worst', () => {
    const many = Array.from({ length: MAX_DEPENDENCY_FINDINGS + 10 }, (_, index) => ({
      packageName: `pkg-${String(index)}`,
      ids: [],
      summary: 'x',
      severity: index === MAX_DEPENDENCY_FINDINGS + 5 ? ('critical' as const) : ('low' as const),
      severityKnown: true,
      manifest: 'package-lock.json',
    }));
    const findings = dependencyFindings(many, 'osv-scanner');
    expect(findings).toHaveLength(MAX_DEPENDENCY_FINDINGS);
    expect(findings[0]?.severity).toBe('critical');
  });

  it('drops an advisory that names an unsafe path', () => {
    const findings = dependencyFindings(
      [
        {
          packageName: 'x',
          ids: [],
          summary: 'y',
          severity: 'low',
          severityKnown: true,
          manifest: '../x',
        },
      ],
      'npm',
    );
    expect(findings).toEqual([]);
  });
});

function invocation(argumentsValue: Record<string, unknown>, operation = 'run'): ToolInvocation {
  return {
    toolName: dependencyAuditToolDefinition.name,
    operation,
    arguments: argumentsValue,
  } as unknown as ToolInvocation;
}

function port(overrides: Partial<DependencyAuditPort> = {}): DependencyAuditPort {
  return {
    manifests: async () => new Set(['package-lock.json']),
    available: async (executable) => executable === 'npm',
    run: async () => ({ stdout: JSON.stringify(npmReport), timedOut: false, truncated: false }),
    relativize: () => undefined,
    record: vi.fn((findings) => findings.length),
    ...overrides,
  };
}

describe('DependencyAuditToolExecutor', () => {
  it('skips a scanner that is not installed and records what the next one finds', async () => {
    const seat = port();
    const result = await new DependencyAuditToolExecutor(seat).execute(invocation({}));
    expect(result.structured).toEqual({
      audited: true,
      scanner: 'npm',
      manifest: 'package-lock.json',
      advisories: 3,
      recorded: 3,
    });
  });

  it('reports no-scanner rather than installing one', async () => {
    const result = await new DependencyAuditToolExecutor(
      port({ available: async () => false }),
    ).execute(invocation({ scanner: 'auto' }));
    expect(result.structured).toMatchObject({ audited: false, reason: 'no-scanner' });
  });

  it('reports a timeout, an oversized report and output that is not JSON', async () => {
    const run = async (
      output: Partial<{ stdout: string; timedOut: boolean; truncated: boolean }>,
    ): Promise<unknown> =>
      (
        await new DependencyAuditToolExecutor(
          port({
            run: async () => ({ stdout: '{}', timedOut: false, truncated: false, ...output }),
          }),
        ).execute(invocation({ scanner: 'npm' }))
      ).structured;
    expect(await run({ timedOut: true })).toMatchObject({ reason: 'timed-out' });
    expect(await run({ truncated: true })).toMatchObject({ reason: 'too-large' });
    expect(await run({ stdout: 'npm ERR!' })).toMatchObject({ reason: 'not-json' });
  });

  it('records nothing when the scanner found nothing', async () => {
    const seat = port({
      run: async () => ({ stdout: '{"vulnerabilities":{}}', timedOut: false, truncated: false }),
    });
    const result = await new DependencyAuditToolExecutor(seat).execute(invocation({}));
    expect(result.structured).toMatchObject({ audited: true, recorded: 0 });
    expect(seat.record).not.toHaveBeenCalled();
  });

  it('refuses other tools, other operations and unknown scanners', async () => {
    const executor = new DependencyAuditToolExecutor(port());
    await expect(
      executor.execute({ ...invocation({}), toolName: 'workspace.scan' }),
    ).rejects.toThrow('Unknown dependency audit tool');
    await expect(executor.execute(invocation({}, 'install'))).rejects.toThrow('operation');
    await expect(executor.execute(invocation({ scanner: 'snyk' }))).rejects.toThrow();
  });

  it('asks for approval like any process that reaches the network', () => {
    expect(dependencyAuditToolDefinition.riskClasses).toEqual(['process', 'network']);
  });
});

describe('/security-review', () => {
  it('ships as a built-in command a workspace skill can replace', async () => {
    const sources = { global: async () => [], project: async () => [] };
    const catalog = new SkillCatalogService(sources, BUILT_IN_SKILLS);
    const builtIn = await catalog.find('security-review');
    expect(builtIn?.body).toContain('workspace.dependency-audit');
    expect(builtIn?.body).toContain('Do not send code or findings to any external service');

    const overridden = new SkillCatalogService(
      {
        global: async () => [],
        project: async () => [{ fileName: 'security-review.md', content: 'Our own checklist.' }],
      },
      BUILT_IN_SKILLS,
    );
    expect((await overridden.find('security-review'))?.body).toBe('Our own checklist.');
  });
});
