import { describe, expect, it } from 'vitest';

import {
  allowedExecutables,
  isAllowedExecutable,
} from '../../src/headless/headless-command-policy';
import { HEADLESS_DEFAULT_EXECUTABLES } from '../../src/headless/headless-command-policy.constants';

describe('isAllowedExecutable', () => {
  it('allows what a coding task needs by default', () => {
    for (const name of HEADLESS_DEFAULT_EXECUTABLES) {
      expect(isAllowedExecutable(name, HEADLESS_DEFAULT_EXECUTABLES)).toBe(true);
    }
  });

  it('refuses a command nobody allowed, whatever it is', () => {
    for (const name of ['curl', 'bash', 'sh', 'powershell', 'rm', 'ssh']) {
      expect(isAllowedExecutable(name, HEADLESS_DEFAULT_EXECUTABLES)).toBe(false);
    }
  });

  it('refuses any name carrying a path, which would make the allowlist decorative', () => {
    for (const name of ['../../bin/node', '/usr/bin/node', 'C:\\Windows\\node', 'dir/node']) {
      expect(isAllowedExecutable(name, ['node'])).toBe(false);
    }
  });

  it('decides the same way on Windows spelling as on any other', () => {
    expect(isAllowedExecutable('NODE.EXE', ['node'])).toBe(true);
    expect(isAllowedExecutable('node.exe', ['node'])).toBe(true);
  });

  it('refuses an empty name rather than spawning the shell default', () => {
    expect(isAllowedExecutable('', ['node'])).toBe(false);
  });

  it('refuses a name that merely contains an allowed one', () => {
    expect(isAllowedExecutable('nodemon', ['node'])).toBe(false);
    expect(isAllowedExecutable('npm-run-all', ['npm'])).toBe(false);
  });
});

describe('allowedExecutables', () => {
  it('adds to the defaults rather than replacing them', () => {
    const allowed = allowedExecutables(['python3']);

    expect(allowed).toContain('python3');
    for (const name of HEADLESS_DEFAULT_EXECUTABLES) expect(allowed).toContain(name);
  });

  it('is just the defaults when nothing was asked for', () => {
    expect(allowedExecutables([])).toEqual([...HEADLESS_DEFAULT_EXECUTABLES]);
  });

  it('ignores an empty request instead of allowing an empty name', () => {
    expect(allowedExecutables([''])).toEqual([...HEADLESS_DEFAULT_EXECUTABLES]);
  });
});

describe('isAllowedExecutable: only launcher extensions are ignored', () => {
  const allowed = ['node', 'npm'];

  it('accepts the spellings Windows needs', () => {
    for (const name of ['node', 'NODE.EXE', 'npm.cmd', 'Npm.CMD']) {
      expect(isAllowedExecutable(name, allowed), name).toBe(true);
    }
  });

  it('refuses any other dot, which is part of the name', () => {
    for (const name of [
      'node.js',
      'node.bat',
      'node.com',
      'node.ps1',
      'node.exe;calc',
      'node.exe.js',
      'nodeXexe',
    ]) {
      expect(isAllowedExecutable(name, allowed), name).toBe(false);
    }
  });
});
