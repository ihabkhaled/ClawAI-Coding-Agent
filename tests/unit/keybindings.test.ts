import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

interface Manifest {
  contributes: {
    commands: { command: string }[];
    keybindings: { command: string; key: string; mac?: string; when?: string }[];
  };
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as Manifest;
const { commands, keybindings } = manifest.contributes;

describe('contributed keybindings', () => {
  it('binds every shortcut to a command that exists', () => {
    const known = new Set(commands.map(({ command }) => command));

    expect(keybindings.filter(({ command }) => !known.has(command))).toEqual([]);
  });

  it('never binds two shortcuts to the same chord', () => {
    const keys = keybindings.map(({ key }) => key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every shortcut a mac equivalent, since cmd is not ctrl', () => {
    expect(keybindings.filter(({ mac }) => mac === undefined)).toEqual([]);
  });

  it('guards editor shortcuts on editor focus so they do not fire from the chat', () => {
    const editorScoped = ['clawAI.reviewCode', 'clawAI.generateTests', 'clawAI.fixCode'];
    const unguarded = keybindings.filter(
      (binding) =>
        editorScoped.includes(binding.command) &&
        binding.when?.includes('editorTextFocus') !== true,
    );

    expect(unguarded).toEqual([]);
  });

  it('reserves a shortcut for stopping a run, which is the one that cannot wait', () => {
    expect(keybindings.some(({ command }) => command === 'clawAI.cancel')).toBe(true);
  });
});
