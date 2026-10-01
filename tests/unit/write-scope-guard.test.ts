import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  call,
  cleanUpRepositories,
  nodeRun,
  scopedRepository,
  scopeOf,
} from './write-scope.helpers';

import type { WriteScopeViolation } from '../../src/sdk/write-scope.types';

afterEach(cleanUpRepositories);

describe('write scope guard', () => {
  it('reverts a hook planted under .git and fails the command', async () => {
    const root = scopedRepository();
    const seen: WriteScopeViolation[] = [];
    const script =
      "require('node:fs').writeFileSync('.git/hooks/pre-commit','#!/bin/sh\\nexit 0\\n')";

    await expect(
      call(root, scopeOf(['src/**'], [], seen), 'workspace.command', 'run', nodeRun(script)),
    ).rejects.toThrow(/hooks\/pre-commit/);

    expect(existsSync(path.join(root, '.git/hooks/pre-commit'))).toBe(false);
    expect(seen[0]?.paths).toContain('.git/hooks/pre-commit');
  });

  it('restores an edited .git/config', async () => {
    const root = scopedRepository();
    const file = path.join(root, '.git/config');
    const original = readFileSync(file, 'utf8');
    const script = "require('node:fs').appendFileSync('.git/config','[core]\\n\\thooksPath=x\\n')";

    await expect(
      call(root, scopeOf(['src/**']), 'workspace.command', 'run', nodeRun(script)),
    ).rejects.toThrow(/\.git\/config/);

    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it('deletes a file the command wrote outside the workspace and fails', async () => {
    const root = scopedRepository();
    const seen: WriteScopeViolation[] = [];
    const outside = path.join(path.dirname(root), 'outside-guard.txt');
    const script = "require('node:fs').writeFileSync('../outside-guard.txt','x')";

    await expect(
      call(root, scopeOf(['src/**'], [], seen), 'workspace.command', 'run', nodeRun(script)),
    ).rejects.toThrow(/outside-guard\.txt/);

    expect(existsSync(outside)).toBe(false);
    expect(seen[0]?.paths).toContain('../outside-guard.txt');
  });

  it('leaves a hook alone when no write scope is configured', async () => {
    const root = scopedRepository();
    const script = "require('node:fs').writeFileSync('.git/hooks/pre-commit','x')";

    const result = await call(root, undefined, 'workspace.command', 'run', nodeRun(script));

    expect(result.exitCode).toBe(0);
    expect(existsSync(path.join(root, '.git/hooks/pre-commit'))).toBe(true);
  });

  it('lets an in-scope git write through when .git is untouched', async () => {
    const root = scopedRepository();
    writeFileSync(path.join(root, 'src/a.ts'), 'changed\n');

    const result = await call(root, scopeOf(['src/**']), 'workspace.git', 'add', {
      paths: ['src/a.ts'],
    });

    expect(result).toBeDefined();
  });
});
