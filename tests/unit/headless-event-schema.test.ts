import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HEADLESS_EXIT_CODES } from '../../src/core/headless-outcome.constants';
import { runHeadlessCli } from '../../src/headless/headless-cli';

import type { HeadlessStreamEvent } from '../../src/headless/headless-session.types';
import type { RuntimeTransportPort } from '../../src/sdk/agent-sdk.types';

type Json = Record<string, unknown>;

const schema = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', 'schemas', 'clawai-headless-events.schema.json'),
    'utf8',
  ),
) as Json;

/**
 * A validator for the keywords this schema uses and no others.
 *
 * `ajv` is only a transitive dependency of the toolchain, so it is not
 * imported; an unknown keyword throws instead, which keeps a later schema edit
 * from silently validating nothing.
 */
const KNOWN = new Set([
  '$schema',
  '$id',
  '$ref',
  'title',
  'description',
  'definitions',
  'oneOf',
  'type',
  'enum',
  'const',
  'required',
  'properties',
  'additionalProperties',
  'minimum',
  'minLength',
  'items',
]);

function resolve(ref: string): Json {
  const found = ref
    .replace('#/', '')
    .split('/')
    .reduce<unknown>((node, key) => (node as Json)[key], schema);
  return found as Json;
}

function typeOk(type: string, value: unknown): boolean {
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'object')
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  return typeof value === type;
}

function errors(node: Json, value: unknown, at: string): string[] {
  for (const keyword of Object.keys(node)) {
    if (!KNOWN.has(keyword)) throw new Error(`Unsupported schema keyword: ${keyword}`);
  }
  if (typeof node.$ref === 'string') return errors(resolve(node.$ref), value, at);
  if (Array.isArray(node.oneOf)) {
    const matching = (node.oneOf as Json[]).filter(
      (option) => errors(option, value, at).length === 0,
    );
    return matching.length === 1 ? [] : [`${at}: matches ${String(matching.length)} of oneOf`];
  }
  if (typeof node.type === 'string' && !typeOk(node.type, value))
    return [`${at}: not ${node.type}`];
  const found = [...valueErrors(node, value, at)];
  if (node.type === 'object') found.push(...objectErrors(node, value as Json, at));
  if (node.type === 'array' && node.items !== undefined) {
    (value as unknown[]).forEach((item, index) => {
      found.push(...errors(node.items as Json, item, `${at}[${String(index)}]`));
    });
  }
  return found;
}

function valueErrors(node: Json, value: unknown, at: string): string[] {
  const found: string[] = [];
  if ('const' in node && node.const !== value) found.push(`${at}: not ${String(node.const)}`);
  if (Array.isArray(node.enum) && !node.enum.includes(value)) found.push(`${at}: not in enum`);
  if (typeof value === 'number' && typeof node.minimum === 'number' && value < node.minimum) {
    found.push(`${at}: below minimum`);
  }
  const short = typeof value === 'string' && value.length < Number(node.minLength ?? 0);
  if (short) found.push(`${at}: too short`);
  return found;
}

function objectErrors(node: Json, value: Json, at: string): string[] {
  const properties = (node.properties ?? {}) as Record<string, Json>;
  const found: string[] = [];
  for (const key of (node.required ?? []) as string[]) {
    if (!(key in value)) found.push(`${at}.${key}: required`);
  }
  for (const [key, entry] of Object.entries(value)) {
    const child = properties[key];
    if (child !== undefined) found.push(...errors(child, entry, `${at}.${key}`));
    else if (node.additionalProperties === false) found.push(`${at}.${key}: not allowed`);
  }
  return found;
}

const valid = (value: unknown): string[] => errors(schema, value, '$');

const result = {
  outcome: 'completed',
  exitCode: 0,
  toolCalls: 1,
  deniedCalls: 0,
  text: 'done',
  runId: 'run-1',
  threadId: 'thread-1',
  terminalEvent: 'run.completed',
};

const SAMPLES: Record<string, Json> = {
  'run.started': { type: 'run.started', runId: 'run-1', threadId: 'thread-1' },
  'run.started (memory off)': {
    type: 'run.started',
    runId: 'run-1',
    threadId: 'thread-1',
    memory: 'off',
  },
  'run.started (account default)': {
    type: 'run.started',
    runId: 'run-1',
    threadId: 'thread-1',
    memory: 'account-default',
  },
  'thread.memory-unchanged': { type: 'thread.memory-unchanged', status: 400 },
  text: { type: 'text', text: 'Hel' },
  'tool.call': {
    type: 'tool.call',
    toolName: 'workspace.file',
    operation: 'read',
    arguments: { path: 'a.txt' },
  },
  'tool.denied': { type: 'tool.denied', toolName: 'workspace.file', operation: 'create' },
  'tool.result': { type: 'tool.result', toolName: 'workspace.file', operation: 'read', ok: true },
  'tool.result (failed)': {
    type: 'tool.result',
    toolName: 'workspace.file',
    operation: 'read',
    ok: false,
    message: 'ENOENT',
  },
  runtime: { type: 'runtime', name: 'run.completed' },
  'runtime (payload)': { type: 'runtime', name: 'budget.updated', payload: { modelTurns: 1 } },
  'budget.exhausted (tool calls)': { type: 'budget.exhausted', budget: 'tool-calls', limit: 3 },
  'budget.exhausted (duration)': { type: 'budget.exhausted', budget: 'duration', limit: 60000 },
  'run.continued (run-lost)': { type: 'run.continued', attempt: 1, reason: 'run-lost' },
  'run.continued (stuck)': { type: 'run.continued', attempt: 2, reason: 'stuck' },
  'run.continued (checks-failed)': { type: 'run.continued', attempt: 1, reason: 'checks-failed' },
  'run.checks (passed)': {
    type: 'run.checks',
    passed: true,
    checks: [{ label: 'tests', ok: true, exitCode: 0, durationMs: 1200 }],
  },
  'run.checks (failed)': {
    type: 'run.checks',
    passed: false,
    checks: [
      { label: 'tests', ok: false, exitCode: 1, durationMs: 900 },
      { label: 'pushed', ok: false, exitCode: -1, durationMs: 5 },
    ],
  },
  'run.finished (checks failed)': {
    type: 'run.finished',
    result: {
      ...result,
      outcome: 'failed',
      exitCode: 1,
      error: 'DONE_CHECKS_FAILED: still failing',
      errorCode: 'DONE_CHECKS_FAILED',
      checks: [{ label: 'tests', ok: false, exitCode: 1 }],
    },
  },
  'run.stuck': { type: 'run.stuck', tool: 'workspace.file', operation: 'read', times: 8 },
  'run.finished (stuck)': {
    type: 'run.finished',
    result: {
      ...result,
      outcome: 'failed',
      exitCode: 1,
      error: 'STUCK: the run made the same call 8 times',
      stuck: { tool: 'workspace.file', operation: 'read', times: 8, target: 'a.txt' },
    },
  },
  'run.retrying (status)': { type: 'run.retrying', attempt: 1, waitMs: 1000, status: 503 },
  'run.retrying (code)': { type: 'run.retrying', attempt: 2, waitMs: 2100, code: 'ECONNRESET' },
  'write-scope.violation (refused)': {
    type: 'write-scope.violation',
    tool: 'workspace.file',
    paths: ['src/other.ts'],
  },
  'write-scope.violation (command)': {
    type: 'write-scope.violation',
    tool: 'workspace.command',
    paths: ['a.txt', 'docs/b.md'],
  },
  'note.added': { type: 'note.added', id: 1, chars: 42 },
  'note.added (tag)': { type: 'note.added', id: 2, tag: 'plan', chars: 7 },
  'run.finished': { type: 'run.finished', result },
  'run.finished (error)': {
    type: 'run.finished',
    result: { ...result, outcome: 'failed', exitCode: 1, error: 'boom' },
  },
};

describe('clawai-headless-events.schema.json', () => {
  it.each(Object.entries(SAMPLES))('accepts a %s event', (_name, sample) => {
    expect(valid(sample)).toEqual([]);
  });

  it('accepts a bare run result, which is what --output-format json prints', () => {
    expect(errors({ $ref: '#/definitions/runResult' }, result, '$')).toEqual([]);
  });

  it.each([
    ['an unknown event type', { type: 'run.exploded' }],
    ['a run.started without a thread', { type: 'run.started', runId: 'r' }],
    ['a run.started with an unknown memory mode', { ...SAMPLES['run.started'], memory: 'on' }],
    ['a memory-unchanged event without a status', { type: 'thread.memory-unchanged' }],
    [
      'a memory-unchanged event carrying more than the status',
      { type: 'thread.memory-unchanged', status: 400, token: 'x' },
    ],
    ['a tool.result with a non-boolean ok', { ...SAMPLES['tool.result'], ok: 'yes' }],
    ['a write-scope.violation without paths', { type: 'write-scope.violation', tool: 'x' }],
    [
      'a write-scope.violation with a non-string path',
      { type: 'write-scope.violation', tool: 'workspace.file', paths: [1] },
    ],
    ['a run.checks without the passed flag', { type: 'run.checks', checks: [] }],
    [
      'a run.checks entry carrying its output',
      {
        type: 'run.checks',
        passed: false,
        checks: [{ label: 'a', ok: false, exitCode: 1, durationMs: 1, output: 'x' }],
      },
    ],
    [
      'a result with an unknown error code',
      { type: 'run.finished', result: { ...result, errorCode: 'NOPE' } },
    ],
    ['a text event with an extra field', { type: 'text', text: 'x', extra: 1 }],
    [
      'an exit code outside the contract',
      { type: 'run.finished', result: { ...result, exitCode: 9 } },
    ],
    ['a negative tool count', { type: 'run.finished', result: { ...result, toolCalls: -1 } }],
    [
      'a budget event naming an unknown guard',
      { type: 'budget.exhausted', budget: 'cost', limit: 1 },
    ],
    ['a budget event with no limit', { type: 'budget.exhausted', budget: 'duration' }],
    ['an unknown outcome', { type: 'run.finished', result: { ...result, outcome: 'meh' } }],
  ])('rejects %s', (_name, sample) => {
    expect(valid(sample)).not.toEqual([]);
  });

  it('lists exactly the exit codes the runner can return', () => {
    const codes = (resolve('#/definitions/exitCode').enum as number[])
      .slice()
      .sort((a, b) => a - b);

    expect(codes).toEqual(Object.values(HEADLESS_EXIT_CODES).sort((a, b) => a - b));
  });

  it('lists exactly the outcomes the runner can report', () => {
    const outcomes = (resolve('#/definitions/outcome').enum as string[]).slice().sort();

    expect(outcomes).toEqual(Object.keys(HEADLESS_EXIT_CODES).sort());
  });

  it('accepts every line a real stream-json run writes', async () => {
    const events: HeadlessStreamEvent[] = [
      { type: 'model.delta', payload: { text: 'Hi' } },
      {
        type: 'tool.requested',
        payload: {
          invocationId: 'i-1',
          toolName: 'workspace.file',
          operation: 'create',
          invocation: { arguments: { path: 'a.txt', content: 'x' } },
        },
      },
      { type: 'run.completed' },
    ];
    const transport: RuntimeTransportPort = {
      signIn: async () => Promise.resolve('t'),
      createThread: async () => Promise.resolve('thread-1'),
      startRun: async () => Promise.resolve({ runId: 'run-1', generation: 'gen-1' }),
      submitResult: async () => Promise.resolve({}),
      events: async function* stream() {
        for (const event of events) yield await Promise.resolve(event);
      },
    };
    const lines: string[] = [];

    const code = await runHeadlessCli(
      ['-p', 'x', '--output-format', 'stream-json'],
      { CLAW_TOKEN: 'token-value', CLAW_STATE_DIR: join(__dirname, '..', '..', 'out', 'none') },
      { stdout: (text) => lines.push(text), stderr: () => undefined },
      {
        cwd: process.cwd(),
        transport,
        sessions: {
          latest: async () => Promise.resolve(undefined),
          remember: async () => Promise.resolve(),
        },
      },
    );

    const parsed = lines.map((line) => JSON.parse(line) as Json);
    expect(code).toBe(0);
    expect(parsed.length).toBeGreaterThanOrEqual(5);
    for (const event of parsed) expect(valid(event)).toEqual([]);
    expect(parsed.map((event) => event.type)).toEqual(
      expect.arrayContaining(['run.started', 'text', 'tool.denied', 'runtime', 'run.finished']),
    );
  });
});
