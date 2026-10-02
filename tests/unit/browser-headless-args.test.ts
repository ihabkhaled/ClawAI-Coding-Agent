import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseHeadlessArgs, parseToolList } from '../../src/headless/headless-args';

const cwd = path.resolve('/work');

function parsed(argv: string[]) {
  return parseHeadlessArgs(argv, {}, cwd);
}

function invocationOf(argv: string[]) {
  const result = parsed(argv);
  if (result.kind !== 'run') throw new Error(`expected a run, got ${result.kind}`);
  return result.invocation;
}

describe('--browser-allow-host', () => {
  it('collects repeated and comma-separated hosts', () => {
    const invocation = invocationOf([
      '-p',
      'x',
      '--browser-allow-host',
      '127.0.0.1',
      '--browser-allow-host',
      'claw.local,other.local',
    ]);
    expect(invocation.browserAllowHosts).toEqual(['127.0.0.1', 'claw.local', 'other.local']);
  });

  it('names a host given as an address, and a missing value', () => {
    expect(parsed(['-p', 'x', '--browser-allow-host', 'https://claw.local/'])).toMatchObject({
      kind: 'usage',
    });
    expect(parsed(['-p', 'x', '--browser-allow-host'])).toMatchObject({ kind: 'usage' });
  });

  it('is absent by default, so no private host is allowed', () => {
    expect(invocationOf(['-p', 'x']).browserAllowHosts).toBeUndefined();
  });

  it('grants the browser category by name, and offers it by default only when hosts are named', () => {
    expect(parseToolList('read,browser')).toEqual(['read', 'browser']);
    expect(invocationOf(['-p', 'x', '--allow-tools', 'browser']).allowTools).toEqual(['browser']);
    expect(invocationOf(['-p', 'x']).allowTools).toEqual(['read', 'git']);
    expect(invocationOf(['-p', 'x', '--browser-allow-host', 'claw.local']).allowTools).toEqual([
      'read',
      'git',
      'browser',
    ]);
  });
});
