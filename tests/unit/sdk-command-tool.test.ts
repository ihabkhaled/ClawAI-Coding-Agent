import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCommandTool, systemCommandRuntime } from '../../src/sdk/command-tool';

import {
  cleanUpWorkspaces,
  eventually,
  isAlive,
  limits,
  nodeScript,
  runCommand,
  workspace,
} from './sdk-command-tool.helpers';

cleanUpWorkspaces();

const SLOW = 30_000;

describe('workspace.command run', () => {
  it('reports the exit code, duration and no timeout', async () => {
    const result = await runCommand(
      createCommandTool(),
      workspace(),
      nodeScript('process.exit(3)'),
    );

    expect(result).toMatchObject({ exitCode: 3, timedOut: false, aborted: false, signal: null });
    expect(result.durationMs).toBeTypeOf('number');
  });

  it('does not block the event loop while the command runs', async () => {
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 20);
    await runCommand(createCommandTool(), workspace(), nodeScript('setTimeout(()=>{},600)'));
    clearInterval(timer);

    expect(ticks).toBeGreaterThan(5);
  });

  it('passes arguments literally, with no shell to interpret them', async () => {
    const result = await runCommand(
      createCommandTool(),
      workspace(),
      nodeScript('process.stdout.write(process.argv[1])', 'a & echo pwned | more'),
    );

    expect(result.stdout).toBe('a & echo pwned | more');
  });

  it('closes stdin so a command that reads it sees the end at once', async () => {
    const result = await runCommand(
      createCommandTool(),
      workspace(),
      nodeScript("process.stdin.on('end',()=>console.log('EOF'));process.stdin.resume()"),
    );

    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(String(result.stdout)).toContain('EOF');
  });

  it('keeps both ends of long output, and reports the cut', async () => {
    const script =
      "process.stdout.write('HEAD'+'x'.repeat(100000)+'TAIL_OF_STDOUT');" +
      "process.stderr.write('y'.repeat(50000)+'FINAL_ERROR')";
    const result = await runCommand(createCommandTool(), workspace(), {
      ...nodeScript(script),
      maxOutputChars: 6_000,
    });

    const stdout = String(result.stdout);
    const stderr = String(result.stderr);
    expect(stdout.startsWith('HEAD')).toBe(true);
    expect(stdout.endsWith('TAIL_OF_STDOUT')).toBe(true);
    expect(stdout).toMatch(/\.\.\. \[\d+ chars omitted\] \.\.\./u);
    expect(stderr.endsWith('FINAL_ERROR')).toBe(true);
    expect(stdout.length + stderr.length).toBeLessThan(6_200);
    expect(result.truncated).toBe(true);
  });

  it('gives a quiet stream nothing to lose and the noisy one the rest', async () => {
    const result = await runCommand(createCommandTool(), workspace(), {
      ...nodeScript("process.stderr.write('small');process.stdout.write('z'.repeat(20000)+'END')"),
      maxOutputChars: 5_000,
    });

    expect(result.stderr).toBe('small');
    expect(String(result.stdout).length).toBeGreaterThan(4_900);
    expect(String(result.stdout).endsWith('END')).toBe(true);
  });

  it('keeps the whole result well under the tool ceiling at the largest budget', async () => {
    const script =
      "process.stdout.write('a'.repeat(300000));process.stderr.write('b'.repeat(300000))";
    const result = await runCommand(createCommandTool(), workspace(), {
      ...nodeScript(script),
      maxOutputChars: 48_000,
    });

    expect(JSON.stringify(result).length).toBeLessThan(50_000);
  });

  it('leaves short output untouched and unflagged', async () => {
    const result = await runCommand(
      createCommandTool(),
      workspace(),
      nodeScript("process.stdout.write('hello')"),
    );

    expect(result).toMatchObject({ stdout: 'hello', stderr: '', truncated: false });
  });

  it(
    'kills the whole process tree on timeout, leaving no orphan',
    async () => {
      const root = workspace();
      const pidFile = path.join(root, 'child.pid');
      const script =
        "const {spawn}=require('node:child_process');const fs=require('node:fs');" +
        "const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});" +
        'fs.writeFileSync(process.argv[1],String(c.pid));setInterval(()=>{},1000)';
      const result = await runCommand(createCommandTool(), root, {
        ...nodeScript(script, pidFile),
        timeoutMs: 3_000,
      });

      expect(result).toMatchObject({ timedOut: true });
      expect(result.durationMs).toBeLessThan(15_000);
      const childPid = Number(readFileSync(pidFile, 'utf8'));
      expect(childPid).toBeGreaterThan(0);
      expect(await eventually(() => !isAlive(childPid))).toBe(true);
    },
    SLOW,
  );

  it(
    'kills the process when the run is aborted',
    async () => {
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort();
      }, 700);
      const started = Date.now();
      const result = await runCommand(
        createCommandTool(),
        workspace(),
        nodeScript('setInterval(()=>{},1000)'),
        controller.signal,
      );

      expect(result).toMatchObject({ aborted: true, timedOut: false });
      expect(Date.now() - started).toBeLessThan(15_000);
    },
    SLOW,
  );

  it('refuses to start when the run was already cancelled', () => {
    const controller = new AbortController();
    controller.abort();

    expect(() =>
      createCommandTool().execute('run', nodeScript('1'), limits(workspace()), controller.signal),
    ).toThrow(/cancelled/u);
  });

  it('runs in a contained working directory', async () => {
    const root = workspace();
    mkdirSync(path.join(root, 'sub'));
    const result = await runCommand(createCommandTool(), root, {
      ...nodeScript('process.stdout.write(process.cwd())'),
      cwd: 'sub',
    });

    expect(String(result.stdout).endsWith('sub')).toBe(true);
  });

  it('refuses a working directory outside the workspace or that does not exist', () => {
    const tool = createCommandTool();
    const root = workspace();
    const attempt = (cwd: string) => () =>
      tool.execute('run', { ...nodeScript('1'), cwd }, limits(root));

    expect(attempt('..')).toThrow(/escapes the workspace/u);
    expect(attempt('missing')).toThrow(/not a directory/u);
  });

  it('clamps the timeout and output budget instead of trusting the model', async () => {
    const result = await runCommand(createCommandTool(), workspace(), {
      ...nodeScript("process.stdout.write('q'.repeat(60000))"),
      timeoutMs: 99_999_999,
      maxOutputChars: 9_999_999,
    });

    expect(String(result.stdout).length).toBeLessThan(48_100);
    expect(result.truncated).toBe(true);
  });
});

describe('workspace.command refusals', () => {
  it('refuses an executable outside the allowlist, and git unless it was allowed', () => {
    const tool = createCommandTool();
    const root = workspace();

    expect(() => tool.execute('run', { executable: 'curl' }, limits(root))).toThrow(/not allowed/u);
    expect(() => tool.execute('run', { executable: 'git' }, limits(root))).toThrow(/not allowed/u);
    expect(() => tool.execute('run', { executable: 'gh' }, limits(root))).toThrow(/not allowed/u);
    expect(() => tool.execute('run', { executable: '../node' }, limits(root))).toThrow(
      /not allowed/u,
    );
  });

  it('runs git once the caller allowed it', async () => {
    const result = await Promise.resolve(
      createCommandTool().execute(
        'run',
        { executable: 'git', arguments: ['--version'] },
        limits(workspace(), ['git']),
      ),
    );

    expect(result).toMatchObject({ exitCode: 0 });
  });

  it('names an executable that is not on PATH', () => {
    expect(() =>
      createCommandTool().execute(
        'run',
        { executable: 'no-such-tool-xyz' },
        limits(workspace(), ['no-such-tool-xyz']),
      ),
    ).toThrow(/no-such-tool-xyz was not found on PATH/u);
  });

  it('names a missing executable argument and malformed arguments', () => {
    const tool = createCommandTool();
    const root = workspace();

    expect(() => tool.execute('run', {}, limits(root))).toThrow(/requires an "executable"/u);
    expect(() =>
      tool.execute('run', { executable: 'node', arguments: Array(51).fill('a') }, limits(root)),
    ).toThrow(/at most 50/u);
    expect(() => tool.execute('run', { executable: 'node', arguments: [1] }, limits(root))).toThrow(
      /must be a string/u,
    );
    expect(() => tool.execute('poke', {}, limits(root))).toThrow(/requires a "processId"/u);
  });
});

describe('workspace.command environment', () => {
  it('reaches the child without secrets, and with CI settings and a usable PATH', async () => {
    const runtime = {
      ...systemCommandRuntime(),
      environment: {
        ...process.env,
        AWS_SECRET_ACCESS_KEY: 'aws-secret',
        GITHUB_TOKEN: 'gh-secret',
        NPM_TOKEN: 'npm-secret',
        CLAW_PASSWORD: 'pw-secret',
        CLAW_TOKEN: 'tok-secret',
        CLAW_EMAIL: 'me@example.com',
        NODE_OPTIONS: '--require ./evil.js',
      },
    };
    const result = await runCommand(
      createCommandTool(runtime),
      workspace(),
      nodeScript('process.stdout.write(JSON.stringify(process.env))'),
    );

    const seen = JSON.parse(String(result.stdout)) as Record<string, string>;
    const text = JSON.stringify(seen);
    for (const secret of [
      'aws-secret',
      'gh-secret',
      'npm-secret',
      'pw-secret',
      'tok-secret',
      'me@example.com',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(seen.NODE_OPTIONS).toBeUndefined();
    expect(seen).toMatchObject({ CI: 'true', FORCE_COLOR: '0', NO_COLOR: '1' });
    expect(Object.keys(seen).some((key) => key.toUpperCase() === 'PATH')).toBe(true);
    expect(existsSync(process.execPath)).toBe(true);
  });
});
