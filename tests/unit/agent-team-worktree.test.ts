import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  collectChanges,
  createWorktree,
  mergeChanges,
  removeWorktree,
} from '../../src/sdk/agent-team-worktree';
import { cleanTeamFixtures, must, readIn, runTeam, scratch } from '../helpers/team-fixture';
import { nap } from '../helpers/team-transport';

afterEach(cleanTeamFixtures);

const AGENT = 'agent.team';

function git(cwd: string, ...args: string[]): string {
  const done = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
  });
  if (done.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${done.stderr}`);
  return done.stdout;
}

function repository(): string {
  const root = scratch('claw-team-repo-');
  git(root, 'init', '-q');
  mkdirSync(path.join(root, 'lib'));
  writeFileSync(path.join(root, 'lib', 'base.ts'), 'export const base = 1;\n');
  writeFileSync(path.join(root, 'README.md'), 'readme\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

function worktreeOf(root: string, state: string) {
  const worktree = createWorktree(root, { stateDirectory: state, runKey: 'r1', name: 'w' });
  if (typeof worktree === 'string') throw new Error(worktree);
  return worktree;
}

describe('worktree helpers', () => {
  it('checks out HEAD in the state directory, collects a change and merges it back', () => {
    const root = repository();
    const state = scratch('claw-team-state-');
    const worktree = worktreeOf(root, state);
    expect(worktree.directory.startsWith(state)).toBe(true);
    expect(readFileSync(path.join(worktree.workspace, 'lib', 'base.ts'), 'utf8')).toContain('base');
    writeFileSync(path.join(worktree.workspace, 'lib', 'new.ts'), 'export const n = 2;\n');
    writeFileSync(path.join(worktree.workspace, 'lib', 'base.ts'), 'export const base = 9;\n');
    const changes = collectChanges(worktree);
    expect([...changes.files].sort()).toEqual(['lib/base.ts', 'lib/new.ts']);
    const report = mergeChanges(worktree, changes, path.join(state, 'p.patch'), () => true);
    expect(report.merged).toBe(true);
    expect(readFileSync(path.join(root, 'lib', 'new.ts'), 'utf8')).toContain('n = 2');
    expect(readFileSync(path.join(root, 'lib', 'base.ts'), 'utf8')).toContain('base = 9');
    removeWorktree(worktree);
    expect(existsSync(worktree.directory)).toBe(false);
    expect(git(root, 'worktree', 'list')).not.toContain('claw-team-state');
  });

  it('refuses a workspace that is not a git repository, and a repository with no commit', () => {
    const state = scratch('claw-team-state-');
    const base = { stateDirectory: state, runKey: 'r', name: 'w' };
    expect(createWorktree(scratch('claw-nogit-'), base)).toContain('git repository');
    const empty = scratch('claw-empty-');
    git(empty, 'init', '-q');
    expect(createWorktree(empty, base)).toContain('at least one commit');
  });

  it('works from a folder inside the repository', () => {
    const root = repository();
    const state = scratch('claw-team-state-');
    const worktree = worktreeOf(path.join(root, 'lib'), state);
    expect(worktree.prefix).toBe('lib');
    expect(existsSync(path.join(worktree.workspace, 'base.ts'))).toBe(true);
    writeFileSync(path.join(worktree.workspace, 'added.ts'), 'x\n');
    const changes = collectChanges(worktree);
    expect(changes.files).toEqual(['lib/added.ts']);
    const patch = path.join(state, 'p.patch');
    const report = mergeChanges(worktree, changes, patch, (name) => name === 'added.ts');
    expect(report.files).toEqual(['added.ts']);
    expect(readFileSync(path.join(root, 'lib', 'added.ts'), 'utf8')).toBe('x\n');
    removeWorktree(worktree);
  });

  it('does not merge a path outside the child scope, and leaves the workspace untouched', () => {
    const root = repository();
    const state = scratch('claw-team-state-');
    const worktree = worktreeOf(root, state);
    writeFileSync(path.join(worktree.workspace, 'lib', 'ok.ts'), 'x\n');
    writeFileSync(path.join(worktree.workspace, 'README.md'), 'hijacked\n');
    const patch = path.join(state, 'p.patch');
    const report = mergeChanges(worktree, collectChanges(worktree), patch, (name) =>
      name.startsWith('lib/'),
    );
    expect(report.merged).toBe(false);
    expect(report.problem).toContain('README.md');
    expect(readFileSync(path.join(root, 'README.md'), 'utf8')).toBe('readme\n');
    expect(existsSync(path.join(root, 'lib', 'ok.ts'))).toBe(false);
    removeWorktree(worktree);
  });

  it('reports a conflict, applies nothing and keeps the patch', () => {
    const root = repository();
    const state = scratch('claw-team-state-');
    const worktree = worktreeOf(root, state);
    writeFileSync(path.join(worktree.workspace, 'lib', 'base.ts'), 'export const base = 2;\n');
    writeFileSync(path.join(worktree.workspace, 'lib', 'extra.ts'), 'x\n');
    writeFileSync(path.join(root, 'lib', 'base.ts'), 'export const base = 3;\n');
    const patchFile = path.join(state, 'conflict.patch');
    const report = mergeChanges(worktree, collectChanges(worktree), patchFile, () => true);
    expect(report.merged).toBe(false);
    expect(report.patchFile).toBe(patchFile);
    expect(existsSync(patchFile)).toBe(true);
    expect(existsSync(path.join(root, 'lib', 'extra.ts'))).toBe(false);
    removeWorktree(worktree);
  });

  it('never follows a link out of the worktree when it removes it', () => {
    const root = repository();
    const state = scratch('claw-team-state-');
    const outside = scratch('claw-outside-');
    writeFileSync(path.join(outside, 'precious.txt'), 'keep me');
    const worktree = worktreeOf(root, state);
    symlinkSync(outside, path.join(worktree.workspace, 'lib', 'link'), 'junction');
    removeWorktree(worktree);
    expect(existsSync(worktree.directory)).toBe(false);
    expect(readdirSync(outside)).toEqual(['precious.txt']);
  });

  it('leaves node_modules out of what a child hands back', () => {
    const root = repository();
    const state = scratch('claw-team-state-');
    const worktree = worktreeOf(root, state);
    mkdirSync(path.join(worktree.workspace, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(path.join(worktree.workspace, 'node_modules', 'dep', 'i.js'), 'x');
    writeFileSync(path.join(worktree.workspace, 'lib', 'real.ts'), 'x\n');
    expect(collectChanges(worktree).files).toEqual(['lib/real.ts']);
    removeWorktree(worktree);
  });
});

describe('agent.team: isolation worktree', () => {
  it('lets two children share a scope in their own checkouts and merges both back', async () => {
    const root = repository();
    const paths: string[] = [];
    const run = await runTeam({
      workspace: root,
      lead: async (api) => {
        for (const name of ['wa', 'wb']) {
          const out = must(
            await api.call(AGENT, 'spawn', {
              name,
              task: 't',
              tools: ['read', 'write'],
              writeScope: ['lib/**'],
              isolation: 'worktree',
            }),
          );
          paths.push(String(out.worktree));
        }
        const waited = must(await api.call(AGENT, 'wait', { timeoutMs: 60_000 }));
        const merges = (waited.children as { merge?: unknown }[]).map((child) => child.merge);
        expect(merges).toEqual([
          { merged: true, files: ['lib/a.ts'] },
          { merged: true, files: ['lib/b.ts'] },
        ]);
      },
      children: {
        wa: async (api) => {
          must(
            await api.call('workspace.file', 'create', {
              path: 'lib/a.ts',
              content: 'export const a = 1;\n',
            }),
          );
        },
        wb: async (api) => {
          must(
            await api.call('workspace.file', 'create', {
              path: 'lib/b.ts',
              content: 'export const b = 1;\n',
            }),
          );
        },
      },
    });
    expect(run.result.outcome).toBe('completed');
    expect(readIn(root, 'lib/a.ts')).toContain('a = 1');
    expect(readIn(root, 'lib/b.ts')).toContain('b = 1');
    expect(paths).toHaveLength(2);
    for (const created of paths) expect(existsSync(created)).toBe(false);
  });

  it('works in its own checkout: the workspace is untouched until the merge', async () => {
    const root = repository();
    let during: boolean | undefined;
    await runTeam({
      workspace: root,
      lead: async (api) => {
        must(
          await api.call(AGENT, 'spawn', {
            name: 'iso',
            task: 't',
            tools: ['read', 'write'],
            isolation: 'worktree',
          }),
        );
        await nap(300, api.signal);
        during = existsSync(path.join(root, 'lib', 'during.ts'));
        must(await api.call(AGENT, 'wait', { timeoutMs: 60_000 }));
      },
      children: {
        iso: async (api) => {
          must(
            await api.call('workspace.file', 'create', { path: 'lib/during.ts', content: 'x\n' }),
          );
          await nap(800, api.signal);
        },
      },
    });
    expect(during).toBe(false);
    expect(readIn(root, 'lib/during.ts')).toBe('x\n');
  });

  it('refuses isolation outside a git repository, naming why', async () => {
    let message = '';
    await runTeam({
      lead: async (api) => {
        message = (
          await api.call(AGENT, 'spawn', { name: 'iso', task: 't', isolation: 'worktree' })
        ).message;
      },
    });
    expect(message).toContain('git repository');
  });

  it('does not merge a child that did not complete, and says so', async () => {
    const root = repository();
    let merge: { merged: boolean; problem?: string } | undefined;
    await runTeam({
      workspace: root,
      lead: async (api) => {
        must(
          await api.call(AGENT, 'spawn', {
            name: 'half',
            task: 't',
            tools: ['read', 'write'],
            isolation: 'worktree',
          }),
        );
        await nap(500, api.signal);
        must(await api.call(AGENT, 'cancel', { name: 'half' }));
        const waited = must(await api.call(AGENT, 'wait', { timeoutMs: 30_000 }));
        merge = (waited.children as { merge?: { merged: boolean; problem?: string } }[])[0]?.merge;
      },
      children: {
        half: async (api) => {
          must(await api.call('workspace.file', 'create', { path: 'lib/half.ts', content: 'x\n' }));
          await nap(20_000, api.signal);
        },
      },
    });
    expect(merge?.merged).toBe(false);
    expect(merge?.problem).toContain('did not complete');
    expect(readIn(root, 'lib/half.ts')).toBeUndefined();
  });
});
