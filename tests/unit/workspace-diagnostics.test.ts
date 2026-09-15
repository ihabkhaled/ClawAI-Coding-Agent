import { describe, expect, it } from 'vitest';

import { selectDiagnostics } from '../../src/core/workspace-diagnostics';

import type { WorkspaceDiagnostic } from '../../src/core/workspace-diagnostics';

function diagnostic(overrides: Partial<WorkspaceDiagnostic> = {}): WorkspaceDiagnostic {
  return {
    path: 'src/a.ts',
    line: 1,
    column: 1,
    severity: 'error',
    message: 'Type error',
    ...overrides,
  };
}

const query = { minimumSeverity: 'hint', maxResults: 100 } as const;

describe('selectDiagnostics', () => {
  it('reads errors first so a capped list never buries them under hints', () => {
    const selection = selectDiagnostics(
      [
        diagnostic({ severity: 'hint', path: 'src/a.ts' }),
        diagnostic({ severity: 'warning', path: 'src/b.ts' }),
        diagnostic({ severity: 'error', path: 'src/c.ts' }),
        diagnostic({ severity: 'information', path: 'src/d.ts' }),
      ],
      query,
    );

    expect(selection.diagnostics.map((entry) => entry.severity)).toEqual([
      'error',
      'warning',
      'information',
      'hint',
    ]);
    expect(selection.counts).toEqual({ error: 1, warning: 1, information: 1, hint: 1 });
  });

  it('orders equal severities by path, then line, then column', () => {
    const selection = selectDiagnostics(
      [
        diagnostic({ path: 'src/b.ts', line: 1, column: 1 }),
        diagnostic({ path: 'src/a.ts', line: 9, column: 2 }),
        diagnostic({ path: 'src/a.ts', line: 9, column: 1 }),
        diagnostic({ path: 'src/a.ts', line: 2, column: 5 }),
      ],
      query,
    );

    expect(
      selection.diagnostics.map(
        (entry) => `${entry.path}:${String(entry.line)}:${String(entry.column)}`,
      ),
    ).toEqual(['src/a.ts:2:5', 'src/a.ts:9:1', 'src/a.ts:9:2', 'src/b.ts:1:1']);
  });

  it('filters below the requested severity', () => {
    const selection = selectDiagnostics(
      [
        diagnostic({ severity: 'error' }),
        diagnostic({ severity: 'warning', path: 'src/b.ts' }),
        diagnostic({ severity: 'hint', path: 'src/c.ts' }),
      ],
      { minimumSeverity: 'warning', maxResults: 100 },
    );

    expect(selection.total).toBe(2);
    expect(selection.counts.hint).toBe(0);
  });

  it('scopes to a file or a directory prefix without matching a sibling', () => {
    const all = [
      diagnostic({ path: 'src/app/main.ts' }),
      diagnostic({ path: 'src/apple/other.ts' }),
      diagnostic({ path: 'tests/a.ts' }),
    ];

    expect(selectDiagnostics(all, { ...query, path: 'src/app' }).total).toBe(1);
    expect(selectDiagnostics(all, { ...query, path: 'src/app/main.ts' }).total).toBe(1);
    expect(selectDiagnostics(all, { ...query, path: 'src' }).total).toBe(2);
  });

  it('counts everything that matched, then caps what is shown', () => {
    const selection = selectDiagnostics(
      Array.from({ length: 10 }, (_entry, index) => diagnostic({ line: index + 1 })),
      { ...query, maxResults: 3 },
    );

    expect(selection.diagnostics).toHaveLength(3);
    expect(selection.total).toBe(10);
    expect(selection.truncated).toBe(true);
  });

  // The editor reports problems for every open document, including files the
  // user opened from outside this workspace. A diagnostic message quotes the
  // source line, so emitting one is a read of a file the tool was never granted.
  it('drops diagnostics that are not inside the workspace', () => {
    const selection = selectDiagnostics(
      [
        diagnostic({ path: 'C:/elsewhere/secret-notes.ts' }),
        diagnostic({ path: '/etc/hosts' }),
        diagnostic({ path: '../sibling-checkout/a.ts' }),
        diagnostic({ path: 'src/a.ts' }),
      ],
      query,
    );

    expect(selection.diagnostics.map((entry) => entry.path)).toEqual(['src/a.ts']);
  });

  // A parse error in an environment file puts a line of it in the message.
  it('drops diagnostics on credential-shaped files', () => {
    const selection = selectDiagnostics(
      [
        diagnostic({ path: '.env', message: 'Unexpected token in STRIPE_KEY=sk_live_x' }),
        diagnostic({ path: 'config/passwords.csv' }),
        diagnostic({ path: 'src/password-reset.controller.ts' }),
      ],
      query,
    );

    expect(selection.diagnostics.map((entry) => entry.path)).toEqual([
      'src/password-reset.controller.ts',
    ]);
  });

  it('normalizes backslash paths before matching a prefix', () => {
    const selection = selectDiagnostics([diagnostic({ path: String.raw`src\nested\a.ts` })], {
      ...query,
      path: 'src/nested',
    });

    expect(selection.total).toBe(1);
  });
});
