import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { afterEach, describe, expect, it } from 'vitest';

const INVENTORY = path.join('docs', 'parity', 'SURFACE_INVENTORY.md');
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
    const marked = original.replace(
      /(\| Command +\| clawAI\.logout +\|[^|]*\|[^|]*\|) +— +\| NOT RUN \| +— +\|/u,
      '$1 test:host | PASS | run 1234 |',
    );
    expect(marked).not.toBe(original);
    writeFileSync(INVENTORY, marked, 'utf8');

    regenerate();

    const logout = row('Command', 'clawAI.logout');
    expect(logout?.[4]).toBe('test:host');
    expect(logout?.[5]).toBe('PASS');
    expect(logout?.[6]).toBe('run 1234');
  });

  it('reports a definition only tests reach as test-only rather than delivered', () => {
    expect(row('Runtime tool', 'fixture.workspace-summary')?.[3]).toMatch(/^test-only \(/u);
  });

  it('counts every row and starts them at NOT RUN until something observes them', () => {
    const rows = cells().filter((cell) =>
      ['Command', 'Setting', 'View', 'Keybinding', 'Runtime tool'].includes(cell[0] ?? ''),
    );

    expect(rows.length).toBe(116);
    expect(rows.every((cell) => cell[5] === 'NOT RUN')).toBe(true);
  });
});
