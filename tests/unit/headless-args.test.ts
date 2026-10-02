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
      budgetProfile: 'long',
      autoContinue: 3,
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

describe('parseHeadlessArgs session, prompt, MCP and permission flags', () => {
  it('reads --resume and --continue, and refuses both together or a bad id', () => {
    expect(run(['-p', 'x', '--resume', 'thread_9-A']).resume).toBe('thread_9-A');
    expect(run(['-p', 'x', '--continue']).continueLast).toBe(true);
    for (const argv of [
      ['-p', 'x', '--resume', 'a', '--continue'],
      ['-p', 'x', '--resume', '../etc'],
    ]) {
      expect(parseHeadlessArgs(argv, {}, cwd).kind).toBe('usage');
    }
  });

  it('keeps an invocation that uses none of the new flags exactly as before', () => {
    const invocation = run(['-p', 'x']);

    for (const key of ['resume', 'continueLast', 'mcpConfig', 'permissionMode', 'allowedTools']) {
      expect(invocation).not.toHaveProperty(key);
    }
  });

  it('resolves prompt and MCP files against the working directory', () => {
    const invocation = run([
      '-p',
      'x',
      '--append-system-prompt',
      '@rules.md',
      '--system-prompt-file',
      'base.md',
      '--mcp-config',
      'mcp.json',
    ]);

    expect(invocation.appendSystemPrompt).toBe('@rules.md');
    expect(invocation.systemPromptFile).toBe(path.resolve(cwd, 'base.md'));
    expect(invocation.mcpConfig).toBe(path.resolve(cwd, 'mcp.json'));
  });

  it('reads comma lists and repeats of --allowed-tools and --disallowed-tools', () => {
    const invocation = run([
      '-p',
      'x',
      '--allowed-tools',
      'workspace.file.*,mcp__echo__*',
      '--allowed-tools',
      'workspace.git.status',
      '--disallowed-tools',
      'workspace.command.*',
    ]);

    expect(invocation.allowedTools).toEqual([
      'workspace.file.*',
      'mcp__echo__*',
      'workspace.git.status',
    ]);
    expect(invocation.disallowedTools).toEqual(['workspace.command.*']);
  });

  it('accepts the three permission modes and names the valid ones otherwise', () => {
    for (const mode of ['plan', 'ask', 'accept-edits']) {
      expect(run(['-p', 'x', '--permission-mode', mode]).permissionMode).toBe(mode);
    }
    const bad = parseHeadlessArgs(['-p', 'x', '--permission-mode', 'yolo'], {}, cwd);

    expect(bad).toMatchObject({ kind: 'usage' });
    expect(JSON.stringify(bad)).toContain('plan, ask, accept-edits');
  });

  it('widens the default tool grant for MCP and for a permission mode, never an explicit one', () => {
    expect(run(['-p', 'x', '--mcp-config', 'm.json']).allowTools).toEqual(['read', 'git', 'mcp']);
    expect(run(['-p', 'x', '--permission-mode', 'ask']).allowTools).toEqual([
      'read',
      'write',
      'command',
      'git',
      'git-write',
      'mcp',
    ]);
    expect(run(['-p', 'x', '--mcp-config', 'm.json', '--allow-tools', 'read']).allowTools).toEqual([
      'read',
    ]);
    expect(parseToolList('read,mcp')).toEqual(['read', 'mcp']);
  });

  it('offers the plan tool only for --task-plan', () => {
    expect(run(['-p', 'x']).taskPlan).toBeUndefined();
    expect(run(['-p', 'x', '--task-plan']).taskPlan).toBe(true);
  });

  it('never widens the default to a new category without its own flag', () => {
    const six = ['read', 'write', 'command', 'git', 'git-write', 'mcp'];

    expect(run(['-p', 'x', '--permission-mode', 'ask']).allowTools).toEqual(six);
    expect(run(['-p', 'x', '--permission-mode', 'strict', '--max-agents', '2']).allowTools).toEqual(
      six,
    );
    expect(run(['-p', 'x', '--http-allow-host', 'localhost']).allowTools).toEqual([
      'read',
      'git',
      'http',
    ]);
    expect(
      run(['-p', 'x', '--permission-mode', 'ask', '--http-allow-host', 'localhost']).allowTools,
    ).toEqual([...six, 'http', 'http-write']);
    expect(
      run(['-p', 'x', '--allow-tools', 'read,http-write', '--http-allow-host', 'a']).allowTools,
    ).toEqual(['read', 'http-write']);
  });
});
