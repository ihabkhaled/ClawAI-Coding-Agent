import { describe, expect, it, vi } from 'vitest';

import { findingSchema } from '../../src/core/findings';
import { FindingsService } from '../../src/services/findings-service';

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

function service() {
  const update = vi.fn();
  return { update, findings: new FindingsService({ update }) };
}

describe('FindingsService', () => {
  // A review is usually several reviewers reporting separately, and each should
  // add to one list rather than replace it.
  it('accumulates across calls instead of replacing', () => {
    const { findings } = service();

    findings.record([finding()]);
    const selection = findings.record([
      finding({ title: 'Missing rate limit', path: 'src/api.ts' }),
    ]);

    expect(selection.total).toBe(2);
    expect(findings.current().total).toBe(2);
  });

  it('collapses a finding two reviewers both reported', () => {
    const { findings } = service();

    findings.record([finding()]);
    const selection = findings.record([finding({ detail: 'Phrased differently.' })]);

    expect(selection.total).toBe(1);
    expect(selection.duplicatesRemoved).toBe(1);
  });

  // A findings store nobody reads would be the sixth dead subsystem this audit
  // has found. Publishing to state is what puts them in front of a person.
  it('publishes every change into the extension state', () => {
    const { findings, update } = service();

    findings.record([finding()]);

    expect(update).toHaveBeenCalledWith({
      findings: [expect.objectContaining({ title: 'Unvalidated redirect' })],
    });
  });

  it('clears on a boundary, because a finding names a path in a closed workspace', () => {
    const { findings, update } = service();

    findings.record([finding()]);
    findings.clear();

    expect(findings.current().total).toBe(0);
    expect(update).toHaveBeenLastCalledWith({ findings: [] });
  });
});
