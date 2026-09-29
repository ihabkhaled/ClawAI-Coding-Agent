import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  authFromEnvironment,
  parseHeadlessArgs,
  parseMaxTurns,
  parseToolList,
} from '../../src/headless/headless-args';

const cwd = path.resolve('/work');

function run(argv: string[], env: Record<string, string> = {}) {
  const parsed = parseHeadlessArgs(argv, env, cwd);
  if (parsed.kind !== 'run') throw new Error(`expected a run, got ${parsed.kind}`);
  return parsed.invocation;
}

describe('parseHeadlessArgs', () => {
  it('reads the full flag set', () => {
    const invocation = run([
      '-p',
      'fix it',
      '--model',
      'm',
      '--provider',
      'OLLAMA',
      '--allow-tools',
      'read,write,command',
      '--allow-command',
      'git',
      '--allow-command',
      'tsc',
      '--output-format',
      'stream-json',
      '--max-turns',
      '7',
      '--workspace',
      'sub',
      '--backend-url',
      'http://x/api',
    ]);

    expect(invocation).toEqual({
      prompt: 'fix it',
      model: 'm',
      provider: 'OLLAMA',
      allowTools: ['read', 'write', 'command'],
      allowCommands: ['git', 'tsc'],
      outputFormat: 'stream-json',
      maxTurns: 7,
      workspace: path.resolve(cwd, 'sub'),
      backendUrl: 'http://x/api',
    });
  });

  it('defaults to text output, read and git tools, and the current directory', () => {
    const invocation = run(['--prompt', 'x']);

    expect(invocation.outputFormat).toBe('text');
    expect(invocation.allowTools).toEqual(['read', 'git']);
    expect(invocation.workspace).toBe(cwd);
    expect(invocation.maxTurns).toBeUndefined();
  });

  it('keeps --json as the older spelling of --output-format json', () => {
    expect(run(['-p', 'x', '--json']).outputFormat).toBe('json');
  });

  it('falls back to the environment for model, provider and backend', () => {
    const invocation = run(['-p', 'x'], {
      CLAW_MODEL: 'env-model',
      CLAW_LIVE_PROVIDER: 'live-provider',
      CLAW_BACKEND_URL: 'http://env',
    });

    expect(invocation).toMatchObject({
      model: 'env-model',
      provider: 'live-provider',
      backendUrl: 'http://env',
    });
  });

  it('asks for help', () => {
    expect(parseHeadlessArgs(['--help'], {}, cwd)).toEqual({ kind: 'help' });
    expect(parseHeadlessArgs(['-h', '-p', 'x'], {}, cwd)).toEqual({ kind: 'help' });
  });

  it.each([
    [[], /prompt is required/u],
    [['-p', '   '], /prompt is required/u],
    [['-p'], /-p needs a value/u],
    [['-p', '--model', 'm'], /-p needs a value/u],
    [['-p', 'x', '--bogus'], /Unknown argument: --bogus/u],
    [['-p', 'x', '--output-format', 'xml'], /--output-format must be/u],
    [['-p', 'x', '--allow-tools', 'read,root'], /Unknown tool category "root"/u],
    [['-p', 'x', '--max-turns', '0'], /--max-turns must be/u],
  ])('reports %j as a usage error', (argv, message) => {
    const parsed = parseHeadlessArgs(argv, {}, cwd);

    expect(parsed.kind).toBe('usage');
    if (parsed.kind === 'usage') expect(parsed.message).toMatch(message);
  });

  it('accepts a prompt that starts with a dash', () => {
    expect(run(['-p', '-fix the flag']).prompt).toBe('-fix the flag');
  });
});

describe('parseToolList', () => {
  it('ignores blanks and whitespace', () => {
    expect(parseToolList(' read , ,git ')).toEqual(['read', 'git']);
  });

  it('allows granting nothing', () => {
    expect(parseToolList('')).toEqual([]);
  });
});

describe('parseMaxTurns', () => {
  it('accepts a whole number in range and refuses others', () => {
    expect(parseMaxTurns('12')).toBe(12);
    expect(parseMaxTurns('1.5')).toMatch(/whole number/u);
    expect(parseMaxTurns('1001')).toMatch(/whole number/u);
    expect(parseMaxTurns(undefined)).toBeUndefined();
  });
});

describe('authFromEnvironment', () => {
  it('prefers a token over email and password', () => {
    expect(
      authFromEnvironment({ CLAW_TOKEN: 'tok', CLAW_EMAIL: 'a@b.c', CLAW_PASSWORD: 'pw' }),
    ).toEqual({ token: 'tok' });
  });

  it('reads email and password, including the older live names', () => {
    expect(authFromEnvironment({ CLAW_EMAIL: 'a@b.c', CLAW_PASSWORD: 'pw' })).toEqual({
      email: 'a@b.c',
      password: 'pw',
    });
    expect(authFromEnvironment({ CLAW_LIVE_EMAIL: 'l@b.c', CLAW_LIVE_PASSWORD: 'lp' })).toEqual({
      email: 'l@b.c',
      password: 'lp',
    });
  });

  it('returns nothing for a missing or blank credential', () => {
    expect(authFromEnvironment({})).toBeUndefined();
    expect(authFromEnvironment({ CLAW_TOKEN: '' })).toBeUndefined();
    expect(authFromEnvironment({ CLAW_EMAIL: 'a@b.c' })).toBeUndefined();
    expect(authFromEnvironment({ CLAW_EMAIL: '', CLAW_PASSWORD: 'x' })).toBeUndefined();
  });
});
