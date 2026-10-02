import { describe, expect, it } from 'vitest';

import {
  maxAgentsProblem,
  parseNames,
  parseSpawn,
  parseTimeout,
  subdirectoryOf,
} from '../../src/sdk/agent-team-args';
import { carveBudget, narrowGrant } from '../../src/sdk/agent-team-narrow';

import type { ParentGrant } from '../../src/sdk/agent-team-narrow';
import type { SpawnRequest } from '../../src/sdk/agent-team-tool.types';

const request = (extra: Partial<SpawnRequest> = {}): SpawnRequest => ({
  name: 'kid',
  task: 't',
  model: undefined,
  tools: undefined,
  writeScope: undefined,
  maxToolCalls: undefined,
  maxDurationSec: undefined,
  workspaceSubdir: undefined,
  isolation: 'none',
  ...extra,
});

const parent = (extra: Partial<ParentGrant> = {}): ParentGrant => ({
  allow: ['read', 'write', 'command', 'agents'],
  writeScope: undefined,
  writeDeny: undefined,
  ...extra,
});

describe('narrowGrant', () => {
  it('defaults to the parent grants without agents', () => {
    const grant = narrowGrant(parent(), request());
    expect(grant).toMatchObject({
      granted: ['read', 'write', 'command'],
      notGranted: [],
      writes: true,
    });
  });

  it('intersects the asked categories with the parent and reports the rest', () => {
    const grant = narrowGrant(
      parent({ allow: ['read', 'agents'] }),
      request({ tools: ['read', 'write'] }),
    );
    expect(grant).toMatchObject({ granted: ['read'], notGranted: ['write'], writes: false });
  });

  it('refuses a child that would hold nothing', () => {
    expect(narrowGrant(parent({ allow: ['read'] }), request({ tools: ['git-write'] }))).toContain(
      'You do not hold git-write',
    );
  });

  it('treats a command as a way to change files', () => {
    expect(narrowGrant(parent(), request({ tools: ['read', 'command'] }))).toMatchObject({
      writes: true,
    });
    expect(narrowGrant(parent(), request({ tools: ['read'] }))).toMatchObject({
      writes: false,
      parentGlobs: [],
    });
  });

  it('keeps the parent scope when none is asked, and "anywhere" when it has none', () => {
    expect(narrowGrant(parent({ writeScope: ['src/**'] }), request())).toMatchObject({
      writeScope: ['src/**'],
      parentGlobs: ['src/**'],
    });
    expect(narrowGrant(parent(), request())).toMatchObject({
      writeScope: undefined,
      parentGlobs: ['**'],
    });
  });

  it('refuses a scope outside the parent scope, and accepts one inside', () => {
    const own = parent({ writeScope: ['src/**', 'docs/*.md'] });
    expect(narrowGrant(own, request({ writeScope: ['src/a/**'] }))).toMatchObject({
      writeScope: ['src/a/**'],
    });
    expect(narrowGrant(own, request({ writeScope: ['docs/*.md'] }))).toMatchObject({
      writeScope: ['docs/*.md'],
    });
    expect(narrowGrant(own, request({ writeScope: ['**'] }))).toContain(
      'not inside your own write scope',
    );
    expect(narrowGrant(own, request({ writeScope: ['src/a/**', 'lib/**'] }))).toContain('"lib/**"');
  });

  it('reads a scope relative to the folder the child is rooted at', () => {
    const grant = narrowGrant(
      parent({ writeScope: ['pkg/**'] }),
      request({ workspaceSubdir: 'pkg/a', writeScope: ['src/**'] }),
    );
    expect(grant).toMatchObject({ writeScope: ['src/**'], parentGlobs: ['pkg/a/src/**'] });
    expect(
      narrowGrant(parent({ writeScope: ['pkg/**'] }), request({ workspaceSubdir: 'other' })),
    ).toContain('not inside your own write scope');
    expect(narrowGrant(parent(), request({ workspaceSubdir: 'a' }))).toMatchObject({
      writeScope: undefined,
      parentGlobs: ['a/**'],
    });
  });

  it('hands the parent deny globs down, read from the child folder', () => {
    const grant = narrowGrant(
      parent({ writeDeny: ['a/secret/**', 'b/**', '**/*.env'] }),
      request({ workspaceSubdir: 'a' }),
    );
    expect(grant).toMatchObject({ writeDeny: ['secret/**', '**/*.env'] });
  });
});

describe('carveBudget', () => {
  it('gives the default when the parent has no limit, and what was asked within the limit', () => {
    expect(carveBudget({ toolCalls: undefined, durationMs: undefined }, request())).toEqual({
      toolCalls: 80,
      durationMs: 600_000,
    });
    expect(
      carveBudget(
        { toolCalls: 500, durationMs: undefined },
        request({ maxToolCalls: 30, maxDurationSec: 60 }),
      ),
    ).toEqual({ toolCalls: 30, durationMs: 60_000 });
  });

  it('never hands out more than the parent has left', () => {
    expect(
      carveBudget(
        { toolCalls: 20, durationMs: 100_000 },
        request({ maxToolCalls: 500, maxDurationSec: 3_000 }),
      ),
    ).toEqual({ toolCalls: 20, durationMs: 70_000 });
  });

  it('keeps half back by default, so a second child still fits', () => {
    expect(carveBudget({ toolCalls: 40, durationMs: undefined }, request())).toMatchObject({
      toolCalls: 20,
    });
    expect(carveBudget({ toolCalls: 12, durationMs: undefined }, request())).toMatchObject({
      toolCalls: 8,
    });
  });

  it('refuses when the parent cannot spare a useful budget', () => {
    expect(carveBudget({ toolCalls: 5, durationMs: undefined }, request())).toContain(
      'only 5 call(s) to spare',
    );
    expect(carveBudget({ toolCalls: -3, durationMs: undefined }, request())).toContain(
      'only 0 call(s)',
    );
    expect(carveBudget({ toolCalls: 100, durationMs: 40_000 }, request())).toContain(
      'time budget is almost used',
    );
  });
});

describe('spawn arguments', () => {
  const ok = { name: 'mod-a', task: 'do it' };

  it('accepts a minimal request and fills the rest with "none"', () => {
    expect(parseSpawn(ok)).toEqual({
      request: request({ name: 'mod-a', task: 'do it' }),
    });
  });

  it.each([
    [{ task: 't' }, 'needs a name'],
    [{ name: 'A', task: 't' }, 'not a valid name'],
    [{ name: '1a', task: 't' }, 'not a valid name'],
    [{ name: 'a'.repeat(30), task: 't' }, 'not a valid name'],
    [{ name: 'all', task: 't' }, 'reserved'],
    [{ name: 'ok' }, 'needs a "task"'],
    [{ name: 'ok', task: 'x'.repeat(8_001) }, 'over 8000'],
    [{ ...ok, tools: 'read' }, 'is a list'],
    [{ ...ok, tools: ['root'] }, 'not a tool category'],
    [{ ...ok, tools: ['mcp'] }, 'not a tool category'],
    [{ ...ok, writeScope: ['/abs/**'] }, 'relative'],
    [{ ...ok, writeScope: ['../x/**'] }, '".."'],
    [{ ...ok, writeScope: [3] }, 'list of workspace-relative'],
    [{ ...ok, writeScope: Array.from({ length: 17 }, (_, i) => `d${String(i)}/**`) }, 'at most 16'],
    [{ ...ok, budget: { maxToolCalls: 0 } }, 'whole number from 1'],
    [{ ...ok, budget: { maxToolCalls: 1.5 } }, 'whole number'],
    [{ ...ok, budget: { maxDurationSec: 5 } }, 'from 10'],
    [{ ...ok, isolation: 'docker' }, 'none or worktree'],
    [{ ...ok, model: 'a b' }, 'not a model id'],
    [{ ...ok, workspaceSubdir: '..' }, 'inside the workspace'],
    [{ ...ok, workspaceSubdir: 'C:\\x' }, 'inside the workspace'],
    [{ ...ok, workspaceSubdir: '/etc' }, 'inside the workspace'],
    [{ ...ok, workspaceSubdir: '' }, 'empty'],
  ])('refuses %j', (args, message) => {
    const parsed = parseSpawn(args);
    expect('problem' in parsed && parsed.problem).toContain(message);
  });

  it('redacts a secret in the task and normalizes the folder', () => {
    const parsed = parseSpawn({
      ...ok,
      task: 'key sk-abcdefghijklmnopqrstuvwxyz123456',
      workspaceSubdir: './a\\b/',
    });
    expect('request' in parsed && parsed.request.task).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect('request' in parsed && parsed.request.workspaceSubdir).toBe('a/b');
  });

  it('reads a folder, the workspace itself as nothing', () => {
    expect(subdirectoryOf('.')).toBeUndefined();
    expect(subdirectoryOf('x/../y')).toBe('y');
    expect(subdirectoryOf('x/../../y')).toEqual({ problem: expect.stringContaining('inside') });
  });

  it('reads wait arguments within bounds', () => {
    expect(parseNames(undefined)).toBeUndefined();
    expect(parseNames(['a', ' b ', ''])).toEqual(['a', 'b']);
    expect(parseNames('a')).toContain('list');
    expect(parseNames(Array.from({ length: 9 }, () => 'a'))).toContain('at most 8');
    expect(parseTimeout(undefined)).toBe(120_000);
    expect(parseTimeout(500)).toBe(500);
    expect(parseTimeout(9_999_999)).toBe(240_000);
    expect(parseTimeout(0)).toContain('milliseconds');
    expect(parseTimeout(Number.NaN)).toContain('milliseconds');
  });

  it('bounds the concurrency', () => {
    expect(maxAgentsProblem(undefined)).toBeUndefined();
    expect(maxAgentsProblem(1)).toBeUndefined();
    expect(maxAgentsProblem(8)).toBeUndefined();
    expect(maxAgentsProblem(0)).toContain('1 to 8');
    expect(maxAgentsProblem(9)).toContain('1 to 8');
    expect(maxAgentsProblem(2.5)).toContain('1 to 8');
  });
});
