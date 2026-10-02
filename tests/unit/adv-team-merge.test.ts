import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { patchProblem } from '../../src/sdk/agent-team-patch';
import {
  collectChanges,
  createWorktree,
  mergeChanges,
  removeWorktree,
} from '../../src/sdk/agent-team-worktree';
import { cleanTeamFixtures, scratch } from '../helpers/team-fixture';

afterEach(cleanTeamFixtures);

function git(cwd: string, ...args: string[]): string {
  const done = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
  });
  if (done.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${done.stderr}`);
  return done.stdout;
}

function repository(): string {
  const root = scratch('claw-adv-repo-');
  git(root, 'init', '-q');
  mkdirSync(path.join(root, 'lib'));
  mkdirSync(path.join(root, 'secrets'));
  writeFileSync(path.join(root, 'lib', 'base.ts'), 'export const base = 1;\n');
  writeFileSync(path.join(root, 'secrets', 'keep.txt'), 'private\n');
  writeFileSync(path.join(root, 'README.md'), 'readme\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

function open(root: string) {
  const state = scratch('claw-adv-state-');
  const made = createWorktree(root, { stateDirectory: state, runKey: 'r1', name: 'w' });
  if (typeof made === 'string') throw new Error(made);
  return { worktree: made, state, patch: path.join(state, 'p.patch') };
}

const inLib = (name: string): boolean => name.startsWith('lib/');

describe('agent.team worktree merge: what a hostile child can hand back', () => {
  it('M01 a rename from outside the scope into it does not delete the source', () => {
    const root = repository();
    const { worktree, patch } = open(root);
    git(worktree.directory, 'mv', 'secrets/keep.txt', 'lib/stolen.txt');
    const report = mergeChanges(worktree, collectChanges(worktree), patch, inLib);
    expect(report.merged).toBe(false);
    expect(readFileSync(path.join(root, 'secrets', 'keep.txt'), 'utf8')).toBe('private\n');
    expect(existsSync(path.join(root, 'lib', 'stolen.txt'))).toBe(false);
    removeWorktree(worktree);
  });

  it('M02 a delete outside the scope is refused and nothing else is applied', () => {
    const root = repository();
    const { worktree, patch } = open(root);
    git(worktree.directory, 'rm', '-q', 'README.md');
    writeFileSync(path.join(worktree.workspace, 'lib', 'ok.ts'), 'ok\n');
    const report = mergeChanges(worktree, collectChanges(worktree), patch, inLib);
    expect(report.merged).toBe(false);
    expect(existsSync(path.join(root, 'README.md'))).toBe(true);
    expect(existsSync(path.join(root, 'lib', 'ok.ts'))).toBe(false);
    removeWorktree(worktree);
  });

  it('M03 a symbolic-link hunk is never planted in the workspace', () => {
    const root = repository();
    const { worktree, patch } = open(root);
    const body = [
      'diff --git a/lib/link b/lib/link',
      'new file mode 120000',
      'index 0000000..1111111',
      '--- /dev/null',
      '+++ b/lib/link',
      '@@ -0,0 +1 @@',
      '+../../outside-target',
      '',
    ].join('\n');
    const report = mergeChanges(worktree, { patch: body, files: ['lib/link'] }, patch, inLib);
    expect(report.merged).toBe(false);
    expect(report.problem).toContain('symbolic link');
    expect(existsSync(path.join(root, 'lib', 'link'))).toBe(false);
    removeWorktree(worktree);
  });

  it('M04 a submodule (gitlink) entry is never merged', () => {
    const root = repository();
    const { worktree, patch } = open(root);
    const body = [
      'diff --git a/lib/sub b/lib/sub',
      'new file mode 160000',
      'index 0000000..1234567',
      '--- /dev/null',
      '+++ b/lib/sub',
      '@@ -0,0 +1 @@',
      '+Subproject commit 1234567890123456789012345678901234567890',
      '',
    ].join(String.fromCharCode(10));
    const report = mergeChanges(worktree, { patch: body, files: ['lib/sub'] }, patch, inLib);
    expect(report.merged).toBe(false);
    expect(existsSync(path.join(root, 'lib', 'sub'))).toBe(false);
    removeWorktree(worktree);
  });

  it('M05 a crafted patch aimed at .git, at .., or at an absolute path applies nothing', () => {
    const root = repository();
    const { worktree, state } = open(root);
    const heads = [
      '.git/hooks/pre-commit',
      '../escaped.txt',
      'lib/../../escaped2.txt',
      path.join(state, 'abs.txt').replaceAll('\\', '/'),
    ];
    for (const [index, target] of heads.entries()) {
      const body = `diff --git a/${target} b/${target}\nnew file mode 100755\n--- /dev/null\n+++ b/${target}\n@@ -0,0 +1 @@\n+boom\n`;
      const report = mergeChanges(
        worktree,
        { patch: body, files: [`lib/f${String(index)}.ts`] },
        path.join(state, `c${String(index)}.patch`),
        () => true,
      );
      expect(report.merged, target).toBe(false);
    }
    expect(existsSync(path.join(root, '.git', 'hooks', 'pre-commit'))).toBe(false);
    expect(existsSync(path.join(path.dirname(root), 'escaped.txt'))).toBe(false);
    expect(existsSync(path.join(state, 'abs.txt'))).toBe(false);
    removeWorktree(worktree);
  });

  it('M06 a binary hunk inside the scope merges byte for byte, one past 16 MiB does not', () => {
    const root = repository();
    const { worktree, patch } = open(root);
    const bytes = Buffer.from(Array.from({ length: 4_096 }, (_, index) => index % 251));
    writeFileSync(path.join(worktree.workspace, 'lib', 'blob.bin'), bytes);
    const changes = collectChanges(worktree);
    expect(mergeChanges(worktree, changes, patch, inLib).merged).toBe(true);
    expect(readFileSync(path.join(root, 'lib', 'blob.bin')).equals(bytes)).toBe(true);
    removeWorktree(worktree);

    const second = open(root);
    const big = Buffer.alloc(18 * 1024 * 1024);
    for (let index = 0; index < big.length; index += 4)
      big.writeUInt32LE((index * 2654435761) >>> 0, index);
    writeFileSync(path.join(second.worktree.workspace, 'lib', 'huge.bin'), big);
    const huge = collectChanges(second.worktree);
    expect(huge.problem).toContain('16 MiB');
    removeWorktree(second.worktree);
  }, 60_000);

  it('M07 a path that is a case variant of a denied folder is judged by the same scope', () => {
    const root = repository();
    const { worktree, patch } = open(root);
    mkdirSync(path.join(worktree.workspace, 'Secrets'), { recursive: true });
    writeFileSync(path.join(worktree.workspace, 'Secrets', 'x.txt'), 'x\n');
    const report = mergeChanges(worktree, collectChanges(worktree), patch, (name) =>
      name.toLowerCase().startsWith('lib/'),
    );
    expect(report.merged).toBe(false);
    removeWorktree(worktree);
  });

  it('M08 a file named like a git internal in the checkout is a plain file and stays in scope rules', () => {
    const root = repository();
    const { worktree, patch } = open(root);
    writeFileSync(path.join(worktree.workspace, 'lib', '.gitattributes'), '* filter=evil\n');
    writeFileSync(path.join(worktree.workspace, 'lib', '.gitmodules'), '[submodule "x"]\n');
    const report = mergeChanges(worktree, collectChanges(worktree), patch, inLib);
    expect(report.merged).toBe(true);
    removeWorktree(worktree);
  });
});

describe('agent.team worktree: leftovers and the patch audit', () => {
  it('O01 a checkout left by a run that died is swept by the next run, a fresh one is not', () => {
    const root = repository();
    const state = scratch('claw-adv-state-');
    const dead = createWorktree(root, { stateDirectory: state, runKey: 'dead', name: 'w' });
    const live = createWorktree(root, { stateDirectory: state, runKey: 'live', name: 'w' });
    if (typeof dead === 'string' || typeof live === 'string') throw new Error('no worktree');
    const old = new Date(Date.now() - 5 * 24 * 60 * 60 * 1_000);
    utimesSync(dead.directory, old, old);
    const next = createWorktree(root, { stateDirectory: state, runKey: 'next', name: 'w' });
    expect(typeof next).toBe('object');
    expect(existsSync(dead.directory)).toBe(false);
    expect(existsSync(live.directory)).toBe(true);
    expect(git(root, 'worktree', 'list')).not.toContain('dead');
    for (const made of [live, next]) if (typeof made !== 'string') removeWorktree(made);
  });

  it('O02 the audit reads headers, never file content that looks like one', () => {
    const lines = (...parts: string[]): string => parts.join(String.fromCharCode(10));
    const content = lines('+new file mode 120000', '-rename from x', ' Subproject commit abc');
    const patch = lines(
      'diff --git a/a.txt b/a.txt',
      'index 1..2 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      content,
      '',
    );
    expect(patchProblem(patch)).toBeUndefined();
    expect(patchProblem(lines('diff --git a/x b/y', 'rename from x', 'rename to y'))).toContain(
      'renames',
    );
    expect(
      patchProblem(lines('diff --git "a/q r" "b/q r"', 'new file mode 100644', '')),
    ).toBeUndefined();
    expect(patchProblem(lines('diff --git "a/q" "b/z"', ''))).toContain('renames');
    expect(patchProblem(lines('old mode 100644', 'new mode 120000', ''))).toContain('symbolic');
    expect(patchProblem(lines('index 1..2 160000', ''))).toContain('regular');
  });
});
