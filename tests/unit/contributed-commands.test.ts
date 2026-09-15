import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

interface ContributedCommand {
  readonly command: string;
  readonly title?: string;
  readonly category?: string;
  readonly icon?: unknown;
  readonly enablement?: string;
}

interface MenuEntry {
  readonly command?: string;
  readonly when?: string;
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  contributes: {
    commands: ContributedCommand[];
    menus?: Record<string, MenuEntry[]>;
    keybindings?: { command: string }[];
  };
  activationEvents?: string[];
};
const commands = manifest.contributes.commands;

function sourceText(): string {
  const parts: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) parts.push(readFileSync(full, 'utf8'));
    }
  };
  walk('src');
  return parts.join('\n');
}

const sources = sourceText();

/**
 * Every contributed command, checked against the manifest rather than a list.
 *
 * A command in the manifest is a row in the user's command palette. If nothing
 * registers it, choosing it raises "command not found" — the worst kind of
 * failure, because the product advertised it. Rule 1 calls that dormant, and
 * these checks are what make dormancy fail a gate instead of a support ticket.
 */
describe('contributed commands', () => {
  it('contributes the command surface the package audit counts', () => {
    expect(commands.length).toBe(43);
  });

  it('names every command under the extension prefix', () => {
    for (const { command } of commands) expect(command.startsWith('clawAI.')).toBe(true);
  });

  it('declares no command twice', () => {
    const identifiers = commands.map((entry) => entry.command);

    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  it('gives every command a title, so the palette never shows an identifier', () => {
    for (const { command, title } of commands) {
      expect(title ?? '', `${command} has no title`).not.toBe('');
    }
  });

  it('localizes every title, so the palette is translated like everything else', () => {
    // A literal title is English for all thirteen locales.
    for (const { command, title } of commands) {
      expect(title ?? '', `${command} has a literal title`).toMatch(/^%.+%$/u);
    }
  });

  it('is referenced from source, so no advertised command is dormant', () => {
    const dormant = commands
      .map((entry) => entry.command)
      .filter((command) => !sources.includes(`'${command}'`));

    expect(dormant, `commands nothing references: ${dormant.join(', ')}`).toEqual([]);
  });

  it('binds every keybinding to a command that exists', () => {
    const identifiers = new Set(commands.map((entry) => entry.command));

    for (const binding of manifest.contributes.keybindings ?? []) {
      expect(identifiers.has(binding.command), `${binding.command} has no command`).toBe(true);
    }
  });

  it('points every menu entry at a command that exists', () => {
    const identifiers = new Set(commands.map((entry) => entry.command));

    for (const [menu, entries] of Object.entries(manifest.contributes.menus ?? {})) {
      for (const entry of entries) {
        if (entry.command === undefined) continue;
        expect(identifiers.has(entry.command), `${menu} points at ${entry.command}`).toBe(true);
      }
    }
  });

  it('never activates on a URI, which would hand activation to any link', () => {
    expect(manifest.activationEvents ?? []).not.toContain('onUri');
  });
});

/**
 * Views are the other half of the advertised surface.
 *
 * A view whose provider is never registered renders as an empty panel with no
 * error, which is worse than a missing command: nothing tells the user it is
 * broken. The container's icon must exist for the same reason.
 */
describe('contributed views', () => {
  const containers = (
    manifest.contributes as unknown as {
      viewsContainers?: Record<string, { id: string; title?: string; icon?: string }[]>;
      views?: Record<string, { id: string; name?: string; type?: string; when?: string }[]>;
    }
  ).viewsContainers;
  const views = (
    manifest.contributes as unknown as {
      views?: Record<string, { id: string; name?: string; type?: string; when?: string }[]>;
    }
  ).views;

  it('puts every view inside a container it declares', () => {
    const declared = new Set(
      Object.values(containers ?? {})
        .flat()
        .map((entry) => entry.id),
    );

    for (const container of Object.keys(views ?? {})) {
      expect(declared.has(container), `${container} is not a declared container`).toBe(true);
    }
  });

  it('gives every view a localized name', () => {
    for (const view of Object.values(views ?? {}).flat()) {
      expect(view.name ?? '', `${view.id} has a literal name`).toMatch(/^%.+%$/u);
    }
  });

  it('declares no view twice', () => {
    const identifiers = Object.values(views ?? {})
      .flat()
      .map((view) => view.id);

    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  it('registers a provider in source for every view it advertises', () => {
    const dormant = Object.values(views ?? {})
      .flat()
      .map((view) => view.id)
      .filter((id) => !sources.includes(`'${id}'`));

    expect(dormant, `views nothing registers: ${dormant.join(', ')}`).toEqual([]);
  });

  it('ships the icon its container points at', () => {
    for (const container of Object.values(containers ?? {}).flat()) {
      const icon = container.icon ?? '';
      expect(icon.length).toBeGreaterThan(0);
      expect(existsSync(icon), `${container.id} icon ${icon} is missing`).toBe(true);
    }
  });
});
