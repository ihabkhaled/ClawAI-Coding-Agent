import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { inheritedEnvironment } from '../../src/core/inherited-environment';
import { INHERITED_ENVIRONMENT_KEYS } from '../../src/core/inherited-environment.constants';
import { containedPath } from '../../src/core/workspace-containment';

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'claw-contain-'));
  created.push(directory);
  return directory;
}

/** Symbolic links need elevation on some Windows configurations; skip rather than fail there. */
function canSymlink(from: string, to: string): boolean {
  try {
    symlinkSync(to, from, 'junction');
    return true;
  } catch {
    return false;
  }
}

describe('containedPath', () => {
  it('accepts an ordinary path inside the workspace', () => {
    const root = workspace();

    expect(containedPath(root, 'src/app.ts')).toBe(path.join(root, 'src/app.ts'));
  });

  it('refuses a path that climbs out with dot-dot', () => {
    expect(() => containedPath(workspace(), '../escape.txt')).toThrow(/escapes/u);
  });

  it('refuses an absolute path somewhere else entirely', () => {
    const elsewhere = workspace();

    expect(() => containedPath(workspace(), path.join(elsewhere, 'x.txt'))).toThrow(/escapes/u);
  });

  it('refuses a symbolic link rather than following it', () => {
    const root = workspace();
    const outside = workspace();
    if (!canSymlink(path.join(root, 'link'), outside)) return;

    expect(() => containedPath(root, 'link')).toThrow(/symbolic link/u);
  });

  it('refuses a write whose parent directory leaves the workspace', () => {
    const root = workspace();
    const outside = workspace();
    if (!canSymlink(path.join(root, 'out'), outside)) return;

    // The file does not exist, so only the resolved parent can reveal this.
    expect(() => containedPath(root, 'out/new-file.txt')).toThrow(/escapes/u);
  });

  it('accepts a new file in a real directory that does not exist yet', () => {
    const root = workspace();
    mkdirSync(path.join(root, 'deep'), { recursive: true });

    expect(containedPath(root, 'deep/nested/file.txt')).toBe(
      path.join(root, 'deep/nested/file.txt'),
    );
  });

  it('accepts the workspace itself', () => {
    const root = workspace();

    expect(containedPath(root, '.')).toBe(root);
  });

  it('still refuses an escape when a real file sits inside', () => {
    const root = workspace();
    writeFileSync(path.join(root, 'real.txt'), 'x');

    expect(containedPath(root, 'real.txt')).toBe(path.join(root, 'real.txt'));
    expect(() => containedPath(root, '../real.txt')).toThrow(/escapes/u);
  });
});

describe('inheritedEnvironment', () => {
  it('passes on only what the allowlist names', () => {
    const built = inheritedEnvironment({ PATH: '/bin', CLAW_LIVE_PASSWORD: 'secret' });

    expect(built.PATH).toBe('/bin');
    expect(Object.keys(built)).not.toContain('CLAW_LIVE_PASSWORD');
  });

  it('carries no credential-shaped variable through, whatever it is called', () => {
    const built = inheritedEnvironment({
      GITHUB_TOKEN: 'a',
      AWS_SECRET_ACCESS_KEY: 'b',
      ANTHROPIC_API_KEY: 'c',
      NPM_TOKEN: 'd',
    });

    expect(Object.keys(built)).toHaveLength(0);
  });

  it('starts from nothing, so a new secret variable is excluded without being listed', () => {
    for (const key of Object.keys(inheritedEnvironment({ SOMETHING_INVENTED_TOMORROW: 'x' }))) {
      expect(INHERITED_ENVIRONMENT_KEYS).toContain(key);
    }
  });

  it('lets a caller add what the command genuinely needs', () => {
    expect(inheritedEnvironment({}, { CLAWAI_TASK: 'build' }).CLAWAI_TASK).toBe('build');
  });

  it('skips a variable the source does not have', () => {
    expect(Object.keys(inheritedEnvironment({}))).toHaveLength(0);
  });
});
