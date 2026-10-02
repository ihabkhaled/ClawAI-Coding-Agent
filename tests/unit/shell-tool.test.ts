import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { systemCommandRuntime } from '../../src/sdk/command-tool';
import { availableShells, findDefaultShell, findShell } from '../../src/sdk/shell-detect';
import { createShellTool } from '../../src/sdk/shell-tool';

import { cleanUpWorkspaces, eventually, isAlive, workspace } from './sdk-command-tool.helpers';

import type { ShellKind } from '../../src/sdk/shell-tool.types';
import type { WriteScope } from '../../src/sdk/write-scope.types';

cleanUpWorkspaces();

const runtime = systemCommandRuntime();
const has = (kind: ShellKind): boolean => findShell(kind, runtime) !== undefined;
const windows = process.platform === 'win32';
const SLOW = 30_000;
const GITHUB_TOKEN = ['ghp', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_');
const NPM_TOKEN = ['npm', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_');

const logs: string[] = [];
afterEach(() => {
  for (const directory of logs.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function logDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'claw-shell-log-'));
  logs.push(directory);
  return directory;
}

function toolIn(extra: { deny?: string[]; log?: string; scope?: WriteScope } = {}) {
  return createShellTool({ deny: extra.deny, logDirectory: extra.log }, extra.scope);
}

async function run(
  root: string,
  args: Record<string, unknown>,
  tool = toolIn(),
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return (await tool.execute('run', args, root, signal)) as Record<string, unknown>;
}

describe.runIf(has('bash'))('workspace.shell in bash', () => {
  it('runs what workspace.command cannot: &&, pipes, redirects, globs, env assignments', async () => {
    const root = workspace();
    mkdirSync(path.join(root, 'sub'));
    writeFileSync(path.join(root, 'sub', 'a.txt'), 'alpha\n');
    writeFileSync(path.join(root, 'sub', 'b.txt'), 'beta\n');
    const result = await run(root, {
      shell: 'bash',
      script:
        'cd sub && cat *.txt | tr a-z A-Z > out.upper && FOO=bar node -p "process.env.FOO" && cat out.upper',
    });

    expect(result).toMatchObject({ shell: 'bash', exitCode: 0, timedOut: false });
    expect(String(result.stdout)).toContain('bar');
    expect(String(result.stdout)).toContain('ALPHA');
    expect(readFileSync(path.join(root, 'sub', 'out.upper'), 'utf8')).toContain('BETA');
  });

  it('runs a here-doc', async () => {
    const root = workspace();
    const result = await run(root, {
      shell: 'bash',
      script: 'cat <<EOF > note.txt\nline one\nEOF\ncat note.txt',
    });

    expect(String(result.stdout)).toContain('line one');
  });

  it('reports a failing script by its exit code and keeps stderr apart', async () => {
    const result = await run(workspace(), {
      shell: 'bash',
      script: 'echo out && echo err 1>&2 && exit 7',
    });

    expect(result).toMatchObject({ exitCode: 7, timedOut: false });
    expect(String(result.stdout)).toContain('out');
    expect(String(result.stderr)).toContain('err');
  });

  it('uses the first failure of an && chain', async () => {
    const result = await run(workspace(), { shell: 'bash', script: 'false && echo never' });

    expect(result.exitCode).not.toBe(0);
    expect(String(result.stdout)).not.toContain('never');
  });

  it('keeps quotes, dollar signs, backticks and unicode intact', async () => {
    const result = await run(workspace(), {
      shell: 'bash',
      script: `echo 'single $x' "double $((1+2))" \`echo tick\` caf\u00e9 "a b"`,
    });

    expect(String(result.stdout).trim()).toBe('single $x double 3 tick caf\u00e9 a b');
  });

  it('closes stdin so a script that reads it sees the end at once', async () => {
    const result = await run(workspace(), { shell: 'bash', script: 'cat; echo done' });

    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(String(result.stdout)).toContain('done');
  });

  it('starts in the workspace, and in a contained cwd when one is given', async () => {
    const root = workspace();
    mkdirSync(path.join(root, 'deep'));
    const here = await run(root, { shell: 'bash', script: 'pwd' });
    const deep = await run(root, { shell: 'bash', script: 'pwd', cwd: 'deep' });

    expect(String(here.stdout).trim().toLowerCase()).toContain(path.basename(root).toLowerCase());
    expect(String(deep.stdout).trim().endsWith('deep')).toBe(true);
  });

  it('refuses a cwd outside the workspace or that is not a directory', async () => {
    const root = workspace();
    writeFileSync(path.join(root, 'file.txt'), 'x');

    await expect(run(root, { script: 'pwd', cwd: '..' })).rejects.toThrow(/escapes the workspace/);
    await expect(run(root, { script: 'pwd', cwd: 'file.txt' })).rejects.toThrow(/not a directory/);
  });

  it('does not hand secrets from the parent environment to the script', async () => {
    const secretRuntime = {
      ...runtime,
      environment: {
        ...process.env,
        ANTHROPIC_API_KEY: 'sk-live-should-not-leak-0123456789',
        MY_SERVICE_TOKEN: 'tok-should-not-leak',
        CLAW_PASSWORD: 'pw-should-not-leak',
      },
    };
    const tool = createShellTool({}, undefined, secretRuntime);
    const result = (await tool.execute(
      'run',
      {
        shell: 'bash',
        script: 'echo "[$ANTHROPIC_API_KEY][$MY_SERVICE_TOKEN][$CLAW_PASSWORD][$CI]"',
      },
      workspace(),
    )) as Record<string, unknown>;

    expect(String(result.stdout).trim()).toBe('[][][][true]');
  });

  it('redacts a secret a script prints from a file', async () => {
    const root = workspace();
    writeFileSync(path.join(root, '.env'), `GITHUB_TOKEN=${GITHUB_TOKEN}\n`);
    const result = await run(root, { shell: 'bash', script: 'cat .env' });

    expect(String(result.stdout)).not.toContain(GITHUB_TOKEN);
  });

  it('keeps the start and the END of a very long output and says it cut the middle', async () => {
    const result = await run(workspace(), {
      shell: 'bash',
      script: 'node -e "for(let i=0;i<20000;i++)console.log(\'line \'+i)"',
    });

    expect(result.truncated).toBe(true);
    expect(String(result.stdout)).toContain('line 0');
    expect(String(result.stdout)).toContain('line 19999');
    expect(String(result.stdout)).toContain('chars omitted');
    expect(String(result.stdout).length).toBeLessThan(30_000);
  });

  it(
    'kills the whole process tree on timeout',
    async () => {
      const root = workspace();
      const result = await run(root, {
        shell: 'bash',
        timeoutMs: 1_500,
        script:
          "node -e \"require('fs').writeFileSync('pid.txt',String(process.pid));setInterval(()=>{},1000)\" & wait",
      });

      expect(result.timedOut).toBe(true);
      const pidFile = path.join(root, 'pid.txt');
      expect(existsSync(pidFile)).toBe(true);
      const pid = Number(readFileSync(pidFile, 'utf8'));
      expect(await eventually(() => !isAlive(pid), 10_000)).toBe(true);
    },
    SLOW,
  );

  it.runIf(windows)(
    'leaves no Git Bash child (sleep.exe) behind after a timeout',
    async () => {
      const result = await run(workspace(), {
        shell: 'bash',
        timeoutMs: 1_500,
        script: 'sleep 307',
      });
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      const alive = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          '(Get-CimInstance Win32_Process -Filter "Name=\'sleep.exe\'").CommandLine',
        ],
        { encoding: 'utf8' },
      );

      expect(result.timedOut).toBe(true);
      expect(alive).not.toContain('307');
    },
    SLOW,
  );

  it(
    'stops a running script when the run is cancelled',
    async () => {
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort();
      }, 700);
      const result = await run(
        workspace(),
        { shell: 'bash', script: 'sleep 30' },
        toolIn(),
        controller.signal,
      );

      expect(result.aborted).toBe(true);
      expect(Number(result.durationMs)).toBeLessThan(15_000);
    },
    SLOW,
  );

  it('refuses before starting when the run was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      run(workspace(), { shell: 'bash', script: 'echo hi' }, toolIn(), controller.signal),
    ).rejects.toThrow(/cancelled/);
  });

  it('runs two scripts at once without mixing their output', async () => {
    const root = workspace();
    const tool = toolIn();
    const [first, second] = await Promise.all([
      run(root, { shell: 'bash', script: 'sleep 0.3; echo first' }, tool),
      run(root, { shell: 'bash', script: 'echo second' }, tool),
    ]);

    expect(String(first.stdout).trim()).toBe('first');
    expect(String(second.stdout).trim()).toBe('second');
  });
});

describe('workspace.shell validation and refusal', () => {
  it('names each bad argument', async () => {
    const root = workspace();

    await expect(run(root, {})).rejects.toThrow(/requires a "script"/);
    await expect(run(root, { script: '   ' })).rejects.toThrow(/requires a "script"/);
    await expect(run(root, { script: 'x'.repeat(30_000) })).rejects.toThrow(/at most 20000/);
    await expect(run(root, { script: 'ls', shell: 'fish' })).rejects.toThrow(/must be one of/);
    await expect(Promise.resolve(toolIn().execute('output', {}, root))).rejects.toThrow(
      /Unsupported operation/,
    );
  });

  it('refuses a screened script, says why, runs nothing, and logs the refusal', async () => {
    const root = workspace();
    const log = logDirectory();
    const marker = path.join(root, 'ran.txt');

    await expect(
      run(root, { script: `touch ran.txt && git push --force` }, toolIn({ log })),
    ).rejects.toThrow(/refused \(force-push\)/);

    expect(existsSync(marker)).toBe(false);
    const line = JSON.parse(readFileSync(path.join(log, 'shell.log'), 'utf8').trim()) as Record<
      string,
      unknown
    >;
    expect(line).toMatchObject({ refusedBy: 'force-push' });
  });

  it('applies the operator --shell-deny patterns', async () => {
    await expect(
      run(
        workspace(),
        { script: 'echo deploy to prod' },
        toolIn({ deny: ['deploy\\s+to\\s+prod'] }),
      ),
    ).rejects.toThrow(/operator-deny/);
  });

  it('screen() gives the same reason without running anything', () => {
    const tool = toolIn();
    const root = workspace();

    expect(tool.screen({ script: 'sudo ls' }, root)).toContain('privilege-escalation');
    expect(tool.screen({ script: 'ls' }, root)).toBeUndefined();
    expect(tool.screen({}, root)).toContain('requires a "script"');
  });
});

describe('workspace.shell log', () => {
  it.runIf(has('bash'))('records every script and its exit code, redacted', async () => {
    const root = workspace();
    const log = logDirectory();
    await run(
      root,
      {
        shell: 'bash',
        script: `export NPM_TOKEN=${NPM_TOKEN}; exit 3`,
      },
      toolIn({ log }),
    );

    const text = readFileSync(path.join(log, 'shell.log'), 'utf8');
    const line = JSON.parse(text.trim()) as Record<string, unknown>;
    expect(line).toMatchObject({ shell: 'bash', exitCode: 3, timedOut: false });
    expect(String(line.script)).not.toContain(NPM_TOKEN);
    expect(line.at).toBeTypeOf('string');
  });

  it('a log that cannot be written never breaks the call', async () => {
    const root = workspace();
    const blocker = path.join(root, 'blocker');
    writeFileSync(blocker, 'a file where the log directory should be');
    const tool = toolIn({ log: path.join(blocker, 'nested') });

    await expect(run(root, { script: 'echo hi' }, tool)).resolves.toBeDefined();
  });
});

describe('shell selection', () => {
  const nothing = { ...runtime, exists: () => false };

  it('refuses with a clear message when no shell is installed', async () => {
    const tool = createShellTool({}, undefined, nothing);

    await expect(tool.execute('run', { script: 'ls' }, workspace())).rejects.toThrow(
      /found no shell/,
    );
    expect(findDefaultShell(nothing)).toBeUndefined();
    expect(availableShells(nothing)).toEqual([]);
  });

  it('says what is available when the requested shell is not', async () => {
    const onlySh = {
      ...runtime,
      platform: 'linux' as const,
      exists: (file: string) => file === '/bin/sh',
    };
    const tool = createShellTool({}, undefined, onlySh);

    await expect(
      tool.execute('run', { script: 'ls', shell: 'powershell' }, workspace()),
    ).rejects.toThrow(/powershell is not installed here\. Available: sh/);
  });

  it('prefers bash, then sh on POSIX, and bash, PowerShell, cmd on Windows', () => {
    const posixRuntime = (present: string[]) => ({
      ...runtime,
      platform: 'linux' as const,
      environment: { PATH: '/usr/bin' },
      exists: (file: string) => present.includes(file),
    });

    expect(findDefaultShell(posixRuntime(['/bin/sh', '/bin/bash']))?.kind).toBe('bash');
    expect(findDefaultShell(posixRuntime(['/bin/sh']))?.kind).toBe('sh');
    const winRuntime = (present: string[]) => ({
      ...runtime,
      platform: 'win32' as const,
      environment: { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', PATH: '' },
      exists: (file: string) => present.includes(file),
    });
    expect(findDefaultShell(winRuntime(['C:\\Program Files\\Git\\bin\\bash.exe']))?.kind).toBe(
      'bash',
    );
    expect(
      findDefaultShell(
        winRuntime(['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe']),
      )?.kind,
    ).toBe('powershell');
    expect(findDefaultShell(winRuntime(['C:\\Windows\\System32\\cmd.exe']))?.kind).toBe('cmd');
  });

  it('never picks the WSL launcher that answers to bash on Windows', () => {
    const wsl = {
      ...runtime,
      platform: 'win32' as const,
      environment: { SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32' },
      exists: (file: string) => /system32[\\/]bash\.exe$/iu.test(file),
    };

    expect(findShell('bash', wsl)).toBeUndefined();
  });

  it('builds the exact arguments each shell needs', () => {
    const win = {
      ...runtime,
      platform: 'win32' as const,
      environment: { SystemRoot: 'C:\\Windows', PATH: '' },
      exists: () => true,
    };
    const powershell = findShell('powershell', win);
    const cmd = findShell('cmd', win);
    const bash = findShell('bash', { ...runtime, platform: 'linux', exists: () => true });

    expect(bash?.argumentsFor('echo "a b"')).toEqual(['--noprofile', '--norc', '-c', 'echo "a b"']);
    const encoded = powershell?.argumentsFor('Write-Output "a b"').at(-1) ?? '';
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toContain('Write-Output "a b"');
    expect(powershell?.argumentsFor('x')).toContain('-NonInteractive');
    expect(cmd?.verbatim).toBe(true);
    expect(cmd?.argumentsFor('echo "a & b"\r\necho c')).toEqual([
      '/d',
      '/s',
      '/c',
      '"echo "a & b" & echo c"',
    ]);
  });
});
