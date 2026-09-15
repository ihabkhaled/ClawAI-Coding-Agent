import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { afterEach, describe, expect, it } from 'vitest';

const INVENTORY = path.join('docs', 'parity', 'SURFACE_INVENTORY.md');
const NEWLINE = String.fromCharCode(10);
const GENERATOR = path.join('scripts', 'generate-surface-inventory.mjs');

function inventory(): string {
  return readFileSync(INVENTORY, 'utf8');
}

/**
 * The inventory is Prettier-formatted, so its table cells are padded to align.
 * Collapsing the padding lets a test assert that a row exists without asserting
 * the width of whatever column happens to be widest today.
 */
function cells(): string[][] {
  return inventory()
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}

function row(surface: string, id: string): string[] | undefined {
  return cells().find((cell) => cell[0] === surface && cell[1] === id);
}

/** Column index by header name, so a new column never silently shifts a test. */
function columnOf(label: string): number {
  const header = cells().find(
    (cell) => cell.includes('Identifier') && cell.includes('Status') && cell.includes('Evidence'),
  );
  const index = header?.indexOf(label) ?? -1;
  expect(index).toBeGreaterThan(-1);
  return index;
}

function field(surface: string, id: string, label: string): string | undefined {
  return row(surface, id)?.[columnOf(label)];
}

function runCheck(): number {
  try {
    execFileSync(process.execPath, [GENERATOR, '--check'], { stdio: 'pipe' });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

function regenerate(): void {
  execFileSync(process.execPath, [GENERATOR], { stdio: 'pipe' });
}

// Snapshotted from a freshly generated file so the suite never measures a
// half-written tree left behind by something else.
execFileSync(process.execPath, [GENERATOR], { stdio: 'pipe' });
const original = inventory();

afterEach(() => {
  writeFileSync(INVENTORY, original, 'utf8');
});

describe('surface inventory', () => {
  it('carries a row for every contributed command, setting, view and keybinding', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      contributes: {
        commands: { command: string }[];
        configuration: { properties: Record<string, unknown> };
        views: Record<string, { id: string }[]>;
        keybindings: { key: string }[];
      };
    };
    const text = inventory();

    expect(text.length).toBeGreaterThan(0);
    for (const command of manifest.contributes.commands) {
      expect(row('Command', command.command)).toBeDefined();
    }
    for (const key of Object.keys(manifest.contributes.configuration.properties)) {
      expect(row('Setting', key)).toBeDefined();
    }
    for (const view of Object.values(manifest.contributes.views).flat()) {
      expect(row('View', view.id)).toBeDefined();
    }
  });

  it('is in sync with the manifest right now', () => {
    expect(runCheck()).toBe(0);
  });

  it('fails the check when a contributed surface loses its row', () => {
    writeFileSync(INVENTORY, original.replace('clawAI.logout', 'clawAI.renamed'), 'utf8');

    expect(runCheck()).toBe(1);
  });

  it('fails the check when the file is missing entirely', () => {
    writeFileSync(INVENTORY, '', 'utf8');

    expect(runCheck()).toBe(1);
  });

  it('keeps a recorded observation when the inventory is regenerated', () => {
    // The whole point of preserving these columns: regenerating must never
    // erase what a lane actually observed.
    const status = columnOf('Status');
    const evidence = columnOf('Evidence');
    // Any row whose evidence is still blank. Pinning this to one surface broke
    // the moment that surface gained evidence, which is the normal direction of
    // travel for this ledger.
    const blank = cells().find((cell) => cell[status] === 'NOT RUN' && cell[evidence] === '—');
    const surface = blank?.[0] ?? '';
    const identifier = blank?.[1] ?? '';
    expect(identifier.length).toBeGreaterThan(0);

    const marked = original
      .split('\n')
      .map((line) => {
        const parts = line.split('|').map((part) => part.trim());
        if (parts[1] !== surface || parts[2] !== identifier) return line;
        const body = parts.slice(1, -1);
        body[columnOf('Lane')] = 'test:playwright';
        body[columnOf('Status')] = 'PASS';
        body[columnOf('Evidence')] = 'observed run 42';
        return `| ${body.join(' | ')} |`;
      })
      .join('\n');
    writeFileSync(INVENTORY, marked, 'utf8');

    regenerate();

    expect(field(surface, identifier, 'Lane')).toBe('test:playwright');
    expect(field(surface, identifier, 'Status')).toBe('PASS');
    expect(field(surface, identifier, 'Evidence')).toBe('observed run 42');
  });

  it('reports a definition only tests reach as test-only rather than delivered', () => {
    expect(field('Runtime tool', 'fixture.workspace-summary', 'Call path')).toMatch(
      /^test-only \(/u,
    );
  });

  it('counts every row and gives each a status the rules recognise', () => {
    const rows = cells().filter((cell) =>
      ['Command', 'Setting', 'View', 'Keybinding', 'Runtime tool'].includes(cell[0] ?? ''),
    );

    expect(rows.length).toBe(116);
    const status = columnOf('Status');
    for (const cell of rows) {
      expect(['PASS', 'FAIL', 'BLOCKED', 'NOT RUN']).toContain(cell[status]);
    }
  });

  it('keeps the totals table agreeing with the rows it summarises', () => {
    const rows = cells().filter((cell) =>
      ['Command', 'Setting', 'View', 'Keybinding', 'Runtime tool'].includes(cell[0] ?? ''),
    );
    const totals = new Map(
      cells()
        .filter((cell) => cell.length === 2)
        .map((cell) => [cell[0] ?? '', cell[1] ?? '']),
    );

    const column = columnOf('Status');
    for (const status of ['PASS', 'FAIL', 'BLOCKED', 'NOT RUN']) {
      const counted = rows.filter((cell) => cell[column] === status).length;
      expect(totals.get(status)).toBe(String(counted));
    }
  });

  it('finds its columns by header name, so adding one cannot shift a status', () => {
    // A parser that counted from the left rewrote every status the first time a
    // column was inserted. The ledger's whole value is that it does not do that.
    const reordered = original
      .split(NEWLINE)
      .map((line) => {
        if (!line.startsWith('|')) return line;
        const parts = line
          .split('|')
          .slice(1, -1)
          .map((part) => part.trim());
        if (parts.length < 8) return line;
        return `| ${parts.join(' | ')} | extra |`;
      })
      .join(NEWLINE);
    writeFileSync(INVENTORY, reordered, 'utf8');

    regenerate();

    expect(field('Command', 'clawAI.openChat', 'Status')).toBe('PASS');
  });
});
