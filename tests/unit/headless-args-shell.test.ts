import { describe, expect, it } from 'vitest';

import { agentConfigFor } from '../../src/headless/headless-agent-config';
import { parseHeadlessArgs } from '../../src/headless/headless-args';

import type { HeadlessInvocation } from '../../src/headless/headless-args.types';

function parse(...argv: string[]) {
  return parseHeadlessArgs(['-p', 'task', ...argv], {}, '/work');
}

function invocation(...argv: string[]): HeadlessInvocation {
  const result = parse(...argv);
  if (result.kind !== 'run') throw new Error(`expected a run, got ${JSON.stringify(result)}`);
  return result.invocation;
}

function usage(...argv: string[]): string {
  const result = parse(...argv);
  if (result.kind !== 'usage') throw new Error(`expected usage, got ${result.kind}`);
  return result.message;
}

describe('--allow-shell, --allow-tools shell and --shell-deny', () => {
  it('is off by default', () => {
    expect(invocation().allowTools).toEqual(['read', 'git']);
    expect(invocation('--permission-mode', 'ask').allowTools).not.toContain('shell');
    expect(invocation().allowShell).toBeUndefined();
  });

  it('needs both switches: shell in --allow-tools without --allow-shell is refused', () => {
    expect(usage('--allow-tools', 'read,command,shell', '--permission-mode', 'ask')).toContain(
      'also needs --allow-shell',
    );
  });

  it('needs both switches: --allow-shell with an explicit list that lacks shell is refused', () => {
    expect(
      usage('--allow-tools', 'read,command', '--allow-shell', '--permission-mode', 'ask'),
    ).toContain('also needs shell in --allow-tools');
  });

  it('turns on with both switches and a permission mode', () => {
    const run = invocation(
      '--allow-tools',
      'read,write,command,shell',
      '--allow-shell',
      '--permission-mode',
      'accept-edits',
    );

    expect(run.allowTools).toContain('shell');
    expect(run.allowShell).toBe(true);
  });

  it('--allow-shell alone on a mode run adds shell to the default grants', () => {
    const run = invocation('--allow-shell', '--permission-mode', 'accept-edits');

    expect(run.allowTools).toEqual([
      'read',
      'write',
      'command',
      'git',
      'git-write',
      'mcp',
      'shell',
    ]);
  });

  it('refuses --allow-shell with no permission mode, because nothing could approve a script', () => {
    expect(usage('--allow-shell')).toContain('needs --permission-mode');
  });

  it('collects repeatable --shell-deny patterns, and needs --allow-shell', () => {
    const run = invocation(
      '--allow-shell',
      '--permission-mode',
      'ask',
      '--shell-deny',
      'docker\\s+push',
      '--shell-deny',
      'prod,staging',
    );

    expect(run.shellDeny).toEqual(['docker\\s+push', 'prod', 'staging']);
    expect(usage('--shell-deny', 'x')).toContain('needs --allow-shell');
  });

  it('rejects an invalid --shell-deny pattern at parse time', () => {
    expect(usage('--allow-shell', '--permission-mode', 'ask', '--shell-deny', '(')).toContain(
      'not a valid regular expression',
    );
  });

  it('hands the second switch to the SDK permissions only when --allow-shell was given', () => {
    const on = invocation('--allow-shell', '--permission-mode', 'ask', '--shell-deny', 'x');
    const off = invocation('--permission-mode', 'ask');
    const config = (run: HeadlessInvocation) =>
      agentConfigFor({
        invocation: run,
        inputs: { ok: true },
        auth: { token: 't' },
        threadId: undefined,
        environment: {},
        io: { stdout: () => undefined, stderr: () => undefined },
        transport: undefined,
      });

    expect(config(on).permissions?.shell).toEqual({ deny: ['x'] });
    expect(config(off).permissions?.shell).toBeUndefined();
  });
});
