import { describe, expect, it, vi } from 'vitest';

import { findingsFromSarif, sarifLogSchema } from '../../src/core/sarif';
import { MAX_SARIF_FINDINGS } from '../../src/core/sarif.constants';
import {
  SarifImportToolExecutor,
  sarifImportToolDefinition,
} from '../../src/infrastructure/sarif-import-tool-executor';

import type { Finding } from '../../src/core/findings';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

function log(results: unknown[], rules: unknown[] = []): ReturnType<typeof sarifLogSchema.parse> {
  return sarifLogSchema.parse({
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'semgrep', rules } }, results }],
  });
}

function result(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ruleId: 'sql-injection',
    level: 'error',
    message: { text: 'User input reaches a query' },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: 'src/db.ts' },
          region: { startLine: 42 },
        },
      },
    ],
    ...overrides,
  };
}

function invocation(args: Record<string, unknown>): ToolInvocation {
  return {
    toolName: sarifImportToolDefinition.name,
    operation: 'import',
    arguments: args,
  } as ToolInvocation;
}

describe('findingsFromSarif', () => {
  it('turns a result into a finding a reader can open', () => {
    const findings = findingsFromSarif(log([result()]));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      path: 'src/db.ts',
      line: 42,
      severity: 'high',
      confidence: 'medium',
      source: 'semgrep',
    });
  });

  it('never imports at high confidence, whatever the scanner claims', () => {
    const findings = findingsFromSarif(log([result({ level: 'error' })]));

    expect(findings[0]?.confidence).toBe('medium');
  });

  it('prefers the CVSS-style score over the coarse level', () => {
    const findings = findingsFromSarif(
      log([result({ level: 'note', properties: { 'security-severity': '9.1' } })]),
    );

    expect(findings[0]?.severity).toBe('critical');
  });

  it('reads a score the scanner put on the rule rather than the result', () => {
    const findings = findingsFromSarif(
      log(
        [result({ level: 'note' })],
        [{ id: 'sql-injection', properties: { 'security-severity': 7.5 } }],
      ),
    );

    expect(findings[0]?.severity).toBe('high');
  });

  it('falls back to the level when there is no score at all', () => {
    expect(findingsFromSarif(log([result({ level: 'warning' })]))[0]?.severity).toBe('medium');
    expect(findingsFromSarif(log([result({ level: 'note' })]))[0]?.severity).toBe('low');
    expect(findingsFromSarif(log([result({ level: 'none' })]))[0]?.severity).toBe('info');
  });

  it('keeps the CWE, which is the part that survives changing scanners', () => {
    const findings = findingsFromSarif(
      log([result()], [{ id: 'sql-injection', properties: { tags: ['security', 'CWE-89'] } }]),
    );

    expect(findings[0]?.detail).toContain('CWE-89');
  });

  it('drops a result that names a file outside this workspace', () => {
    const findings = findingsFromSarif(
      log([
        result({
          locations: [{ physicalLocation: { artifactLocation: { uri: '../../etc/passwd' } } }],
        }),
      ]),
    );

    expect(findings).toEqual([]);
  });

  it('drops a result with no location rather than guessing one', () => {
    expect(findingsFromSarif(log([result({ locations: [] })]))).toEqual([]);
  });

  it('accepts a file URI, which several scanners emit', () => {
    const findings = findingsFromSarif(
      log([
        result({
          locations: [
            { physicalLocation: { artifactLocation: { uri: 'file:///src/app%20one.ts' } } },
          ],
        }),
      ]),
    );

    expect(findings[0]?.path).toBe('src/app one.ts');
  });

  it('reports the same result once, however many times the scanner listed it', () => {
    expect(findingsFromSarif(log([result(), result()]))).toHaveLength(1);
  });

  it('stops at the cap rather than handing a person four thousand entries', () => {
    const many = Array.from({ length: MAX_SARIF_FINDINGS + 50 }, (_, index) =>
      result({ message: { text: `issue ${String(index)}` }, ruleId: `rule-${String(index)}` }),
    );

    expect(findingsFromSarif(log(many))).toHaveLength(MAX_SARIF_FINDINGS);
  });

  it('reads a log from a scanner that omits most of the specification', () => {
    const minimal = sarifLogSchema.parse({
      runs: [
        {
          results: [
            {
              message: { text: 'something' },
              locations: [{ physicalLocation: { artifactLocation: { uri: 'a.ts' } } }],
            },
          ],
        },
      ],
    });

    expect(findingsFromSarif(minimal)).toHaveLength(1);
  });
});

describe('SarifImportToolExecutor', () => {
  function harness(text: string | undefined) {
    const recorded: Finding[][] = [];
    return {
      recorded,
      executor: new SarifImportToolExecutor({
        readReport: vi.fn(async () => text),
        record: vi.fn(async (findings: readonly Finding[]) => {
          recorded.push([...findings]);
          return findings.length;
        }),
      }),
    };
  }

  it('imports a report and says how much of it landed', async () => {
    const seat = harness(JSON.stringify(log([result()])));

    const output = await seat.executor.execute(invocation({ path: 'scan.sarif' }));

    expect(output.structured).toMatchObject({ imported: true, found: 1, recorded: 1 });
    expect(seat.recorded[0]).toHaveLength(1);
  });

  it('reports an unreadable report rather than failing the run', async () => {
    const output = await harness(undefined).executor.execute(invocation({ path: 'missing.sarif' }));

    expect(output.structured).toMatchObject({ imported: false, reason: 'unreadable' });
  });

  it('separates a file that is not JSON from one that is not a report', async () => {
    const notJson = await harness('not json at all').executor.execute(
      invocation({ path: 'x.sarif' }),
    );

    expect(notJson.structured).toMatchObject({ imported: false, reason: 'not-sarif' });
  });

  it('is an inspect-class tool, because reading a report changes nothing', () => {
    expect(sarifImportToolDefinition.riskClasses).toEqual(['inspect']);
  });
});
