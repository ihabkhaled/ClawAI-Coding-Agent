import { describe, expect, it } from 'vitest';

import { buildInheritedContext } from '../../src/core/sub-agent-inheritance';
import {
  MAX_INHERITED_BYTES,
  MAX_INHERITED_FINDINGS,
} from '../../src/core/sub-agent-inheritance.constants';

import type { Finding } from '../../src/core/findings';
import type { ParentRunContext } from '../../src/core/sub-agent-inheritance.types';

function finding(title: string): Finding {
  return {
    title,
    severity: 'high',
    confidence: 'high',
    path: 'src/a.ts',
    line: 12,
    detail: 'detail',
    remediation: 'remediation',
  };
}

function parent(overrides: Partial<ParentRunContext> = {}): ParentRunContext {
  return {
    goal: 'Rename the adapter and update its callers',
    decisions: [],
    changedPaths: [],
    findings: [],
    ...overrides,
  };
}

describe('buildInheritedContext', () => {
  it('gives a child nothing under the default mode', () => {
    expect(buildInheritedContext('none', parent({ decisions: ['keep the old name'] }))).toBe('');
  });

  it('tells a summary child what the parent is doing', () => {
    const context = buildInheritedContext('summary', parent());

    expect(context).toContain('Rename the adapter and update its callers');
  });

  it('names decisions so a child does not quietly make the opposite one', () => {
    const context = buildInheritedContext(
      'summary',
      parent({ decisions: ['The adapter keeps its constructor signature'] }),
    );

    expect(context).toContain('do not relitigate');
    expect(context).toContain('The adapter keeps its constructor signature');
  });

  it('names files the parent already changed', () => {
    const context = buildInheritedContext('summary', parent({ changedPaths: ['src/a.ts'] }));

    expect(context).toContain('src/a.ts');
  });

  it('withholds findings from a summary child, which does not need them', () => {
    const context = buildInheritedContext(
      'summary',
      parent({ findings: [finding('Unvalidated input')] }),
    );

    expect(context).not.toContain('Unvalidated input');
  });

  it('gives findings to a findings child, so a reviewer does not re-report them', () => {
    const context = buildInheritedContext(
      'findings',
      parent({ findings: [finding('Unvalidated input')] }),
    );

    expect(context).toContain('do not re-report these');
    expect(context).toContain('Unvalidated input');
  });

  it('passes on only the worst findings rather than every one', () => {
    const many = Array.from({ length: MAX_INHERITED_FINDINGS + 5 }, (_, index) =>
      finding(`Issue ${String(index)}`),
    );
    const context = buildInheritedContext('findings', parent({ findings: many }));

    expect(context).toContain('Issue 0');
    expect(context).not.toContain(`Issue ${String(MAX_INHERITED_FINDINGS + 4)}`);
  });

  it('redacts a secret the parent read out of a file', () => {
    const context = buildInheritedContext(
      'summary',
      parent({ decisions: ['Use Authorization: Bearer sk-live-abcdef123456 for the call'] }),
    );

    expect(context).not.toContain('sk-live-abcdef123456');
    expect(context).toContain('[REDACTED]');
  });

  it('bounds what a child inherits, so history does not eat its budget', () => {
    const long = Array.from({ length: 4_000 }, (_, index) => `decision number ${String(index)}`);
    const context = buildInheritedContext('summary', parent({ decisions: long }));

    expect(new TextEncoder().encode(context).byteLength).toBeLessThanOrEqual(MAX_INHERITED_BYTES);
  });

  it('cuts on a line boundary rather than mid-sentence', () => {
    const long = Array.from({ length: 4_000 }, (_, index) => `decision number ${String(index)}`);
    const context = buildInheritedContext('summary', parent({ decisions: long }));
    const lastLine = context.split('\n').at(-1) ?? '';

    expect(lastLine).toMatch(/^- decision number \d+$/u);
  });
});
