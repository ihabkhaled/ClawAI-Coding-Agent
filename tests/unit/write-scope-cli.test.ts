import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { agentConfigFor } from '../../src/headless/headless-agent-config';
import { parseHeadlessArgs } from '../../src/headless/headless-args';
import { textLine } from '../../src/headless/headless-output';
import { createAgent } from '../../src/sdk/create-agent';

import type { HeadlessStreamEvent } from '../../src/headless/headless-session.types';
import type { RuntimeTransportPort } from '../../src/sdk/agent-sdk.types';
import type { AgentEvent } from '../../src/sdk/create-agent.types';

const cwd = path.resolve('/work');
const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function parse(...extra: string[]) {
  return parseHeadlessArgs(['-p', 'task', ...extra], {}, cwd);
}

function invocation(...extra: string[]) {
  const parsed = parse(...extra);
  if (parsed.kind !== 'run') throw new Error(`expected a run, got ${parsed.kind}`);
  return parsed.invocation;
}

describe('--write-scope and --write-deny', () => {
  it('leaves both unset when neither flag is given', () => {
    const parsed = invocation();

    expect(parsed.writeScope).toBeUndefined();
    expect(parsed.writeDeny).toBeUndefined();
  });

  it('reads a comma list and repeats of both flags', () => {
    const parsed = invocation(
      '--write-scope',
      'src/**, docs/*.md',
      '--write-scope',
      'tests/**',
      '--write-deny',
      'src/secret/**',
      '--write-deny',
      '**/*.env,**/*.pem',
    );

    expect(parsed.writeScope).toEqual(['src/**', 'docs/*.md', 'tests/**']);
    expect(parsed.writeDeny).toEqual(['src/secret/**', '**/*.env', '**/*.pem']);
  });

  it('accepts a deny with no scope', () => {
    expect(invocation('--write-deny', 'docs/**').writeDeny).toEqual(['docs/**']);
  });

  it.each([
    [['--write-scope']],
    [['--write-scope', '/etc/**']],
    [['--write-scope', '../x/**']],
    [['--write-deny', 'C:/x/**']],
  ])('is a usage error for %j', (extra) => {
    const parsed = parse(...extra);

    expect(parsed.kind).toBe('usage');
  });

  it('names the flags in a usage message for a bad glob', () => {
    const parsed = parse('--write-scope', '/etc/**');

    expect(parsed).toMatchObject({ kind: 'usage' });
    expect(JSON.stringify(parsed)).toContain('--write-scope/--write-deny');
  });

  it('reaches the agent configuration as permissions', () => {
    const parsed = invocation('--write-scope', 'src/**', '--write-deny', 'src/x/**');

    const config = agentConfigFor({
      invocation: parsed,
      inputs: { ok: true as const },
      auth: { token: 't' },
      threadId: undefined,
      environment: {},
      io: { stdout: () => undefined, stderr: () => undefined },
      transport: undefined,
    });

    expect(config.permissions).toMatchObject({ writeScope: ['src/**'], writeDeny: ['src/x/**'] });
  });
});

describe('createAgent with a write scope', () => {
  it('rejects an unusable glob when the agent is created', () => {
    expect(() =>
      createAgent({
        auth: { token: 't' },
        workspaceRoot: cwd,
        permissions: { allow: ['write'], writeScope: ['/etc/**'] },
      }),
    ).toThrow(RangeError);
  });

  it('emits write-scope.violation for a refused write and lets the run finish', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'claw-scope-agent-'));
    created.push(root);
    writeFileSync(path.join(root, 'keep.txt'), 'keep\n');
    const events: HeadlessStreamEvent[] = [
      {
        type: 'tool.requested',
        payload: {
          invocationId: 'i-1',
          toolName: 'workspace.file',
          operation: 'update',
          invocation: { arguments: { path: 'keep.txt', oldText: 'keep', newText: 'gone' } },
        },
      },
      { type: 'run.completed' },
    ];
    const submitted: unknown[] = [];
    const transport: RuntimeTransportPort = {
      signIn: async () => Promise.resolve('t'),
      createThread: async () => Promise.resolve('thread-1'),
      startRun: async () => Promise.resolve({ runId: 'run-1', generation: 'gen-1' }),
      submitResult: async (_token, _run, _epochs, result) => {
        submitted.push(result);
        return Promise.resolve({});
      },
      events: async function* stream() {
        for (const event of events) yield await Promise.resolve(event);
      },
    };
    const seen: AgentEvent[] = [];

    const result = await createAgent({
      auth: { token: 't' },
      workspaceRoot: root,
      transport,
      permissions: { allow: ['read', 'write'], writeScope: ['src/**'] },
    }).run('edit', { onEvent: (event) => seen.push(event) });

    expect(result.outcome).toBe('completed');
    expect(seen).toContainEqual({
      type: 'write-scope.violation',
      tool: 'workspace.file',
      paths: ['keep.txt'],
    });
    expect(JSON.stringify(submitted)).toContain('outside the write scope');
    expect(readFileSync(path.join(root, 'keep.txt'), 'utf8')).toBe('keep\n');
  });
});

describe('textLine', () => {
  it('shows a person which paths the scope stopped', () => {
    expect(
      textLine({ type: 'write-scope.violation', tool: 'workspace.command', paths: ['a', 'b/c'] }),
    ).toBe('[write-scope] workspace.command: a, b/c\n');
  });
});
