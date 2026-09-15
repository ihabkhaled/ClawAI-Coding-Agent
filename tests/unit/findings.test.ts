import { describe, expect, it } from 'vitest';

import { findingSchema, findingsBlockRelease, mergeFindings } from '../../src/core/findings';

import type { Finding } from '../../src/core/findings';

function finding(overrides: Partial<Finding> = {}): Finding {
  return findingSchema.parse({
    title: 'Unvalidated redirect',
    severity: 'high',
    confidence: 'high',
    path: 'src/auth/login.ts',
    line: 42,
    detail: 'The target comes straight from the query string.',
    remediation: 'Allow only same-origin targets.',
    ...overrides,
  });
}

describe('findingSchema', () => {
  // A finding without a fix is an observation, and a review that produces
  // observations makes the reader decide what to do with each one.
  it('requires a remediation and a confidence', () => {
    const base = {
      title: 'Unvalidated redirect',
      severity: 'high',
      confidence: 'high',
      path: 'src/a.ts',
      detail: 'Detail',
      remediation: 'Fix',
    };

    expect(findingSchema.safeParse(base).success).toBe(true);
    expect(findingSchema.safeParse({ ...base, remediation: undefined }).success).toBe(false);
    expect(findingSchema.safeParse({ ...base, confidence: undefined }).success).toBe(false);
  });

  it('refuses a path outside the workspace or on a credential-shaped file', () => {
    const base = {
      title: 'T',
      severity: 'low',
      confidence: 'low',
      detail: 'D',
      remediation: 'R',
    };

    expect(findingSchema.safeParse({ ...base, path: '../elsewhere/a.ts' }).success).toBe(false);
    expect(findingSchema.safeParse({ ...base, path: '.env' }).success).toBe(false);
    expect(findingSchema.safeParse({ ...base, path: 'C:/other/a.ts' }).success).toBe(false);
  });

  it('normalizes a backslash path', () => {
    expect(finding({ path: String.raw`src\auth\login.ts` }).path).toBe('src/auth/login.ts');
  });
});

describe('mergeFindings', () => {
  // Independent reviewers converge: run three over one diff and the obvious bug
  // arrives three times.
  it('collapses the same claim about the same place', () => {
    const selection = mergeFindings([
      [finding()],
      [finding({ detail: 'Phrased differently by a second reviewer.' })],
      [finding({ line: 43 })],
    ]);

    expect(selection.total).toBe(2);
    expect(selection.duplicatesRemoved).toBe(1);
  });

  // Over-reporting one finding costs a minute of reading; under-reporting it
  // costs the bug shipping.
  it('keeps the highest severity when duplicates disagree', () => {
    const selection = mergeFindings([
      [finding({ severity: 'low' })],
      [finding({ severity: 'critical' })],
    ]);

    expect(selection.findings[0]?.severity).toBe('critical');
  });

  it('orders by severity, then confidence, then location', () => {
    const selection = mergeFindings([
      [
        finding({ title: 'D', severity: 'low', path: 'src/z.ts' }),
        finding({ title: 'B', severity: 'critical', confidence: 'low', path: 'src/b.ts' }),
        finding({ title: 'A', severity: 'critical', confidence: 'high', path: 'src/a.ts' }),
        finding({ title: 'C', severity: 'high', path: 'src/c.ts' }),
      ],
    ]);

    expect(selection.findings.map((entry) => entry.title)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('counts every severity and caps what is shown', () => {
    const selection = mergeFindings(
      [
        Array.from({ length: 10 }, (_entry, index) =>
          finding({ title: `Finding ${String(index)}`, severity: 'medium' }),
        ),
      ],
      3,
    );

    expect(selection.findings).toHaveLength(3);
    expect(selection.total).toBe(10);
    expect(selection.counts.medium).toBe(10);
  });

  it('is stable across runs so two reviews can be compared', () => {
    const batch = [
      finding({ title: 'B', path: 'src/b.ts' }),
      finding({ title: 'A', path: 'src/a.ts' }),
    ];

    expect(mergeFindings([batch]).findings.map((entry) => entry.title)).toEqual(
      mergeFindings([[...batch].reverse()]).findings.map((entry) => entry.title),
    );
  });
});

describe('findingsBlockRelease', () => {
  it('blocks on a confident critical or high finding', () => {
    expect(findingsBlockRelease([finding({ severity: 'critical' })])).toBe(true);
    expect(findingsBlockRelease([finding({ severity: 'high', confidence: 'medium' })])).toBe(true);
  });

  // A low-confidence critical is a question, not a verdict. Blocking on one
  // trains the reader to override the gate.
  it('does not block on a low-confidence finding or a lesser severity', () => {
    expect(findingsBlockRelease([finding({ severity: 'critical', confidence: 'low' })])).toBe(
      false,
    );
    expect(findingsBlockRelease([finding({ severity: 'medium' })])).toBe(false);
    expect(findingsBlockRelease([])).toBe(false);
  });
});
