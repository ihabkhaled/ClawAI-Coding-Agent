import { describe, expect, it } from 'vitest';

import { COMMAND_TOOL_INPUT_SCHEMA } from '../../src/sdk/command-tool-definition.constants';
import { parseRunRequest } from '../../src/sdk/command-tool-request';
import {
  commandEnvironment,
  isUnsafeShimArgument,
  launchCommand,
  resolveCommandExecutable,
} from '../../src/sdk/command-tool-spawn';
import { offeredDefinitions, toolCategory } from '../../src/sdk/workspace-toolkit';

import type { CommandRuntime } from '../../src/sdk/command-tool.types';

const WINDOWS_PATH = 'C:\\Program Files\\nodejs;"C:\\Program Files\\Git\\cmd";;C:\\tools';

function windows(present: readonly string[]): CommandRuntime {
  return {
    platform: 'win32',
    environment: { Path: WINDOWS_PATH, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
    exists: (file) => present.includes(file),
  };
}

describe('Windows shim resolution', () => {
  it('finds npm.cmd and gh.exe through PATHEXT, with quoted entries', () => {
    const runtime = windows([
      'C:\\Program Files\\nodejs\\npm.CMD',
      'C:\\Program Files\\Git\\cmd\\git.EXE',
      'C:\\tools\\gh.EXE',
    ]);
    const resolve = (name: string) => resolveCommandExecutable(name, runtime, runtime.environment);

    expect(resolve('npm')).toBe('C:\\Program Files\\nodejs\\npm.CMD');
    expect(resolve('git')).toBe('C:\\Program Files\\Git\\cmd\\git.EXE');
    expect(resolve('gh')).toBe('C:\\tools\\gh.EXE');
    expect(resolve('missing')).toBeUndefined();
  });

  it('accepts a name that already carries its extension', () => {
    const runtime = windows(['C:\\tools\\npx.cmd']);

    expect(resolveCommandExecutable('npx.cmd', runtime, runtime.environment)).toBe(
      'C:\\tools\\npx.cmd',
    );
  });

  it('does not resolve against the working directory through an empty PATH entry', () => {
    const runtime: CommandRuntime = {
      platform: 'win32',
      environment: { Path: ';C:\\tools' },
      exists: (file) => file === 'git.EXE' || file === 'C:\\tools\\git.EXE',
    };

    expect(resolveCommandExecutable('git', runtime, runtime.environment)).toBe(
      'C:\\tools\\git.EXE',
    );
  });

  it('finds a bare name on POSIX without any extension search', () => {
    const runtime: CommandRuntime = {
      platform: 'linux',
      environment: { PATH: '/usr/local/bin:/usr/bin' },
      exists: (file) => file === '/usr/bin/npm',
    };

    expect(resolveCommandExecutable('npm', runtime, runtime.environment)).toBe('/usr/bin/npm');
  });

  it('refuses arguments a .cmd shim would read as syntax, before any spawn', () => {
    const runtime = windows(['C:\\tools\\npm.CMD']);
    const request = {
      executable: 'npm',
      arguments: ['run', '%PATH%'],
      cwd: 'C:\\work',
      timeoutMs: 1_000,
      maxOutputChars: 1_000,
      background: false,
    };

    expect(() =>
      launchCommand(request, { ...runtime, environment: { Path: 'C:\\tools' } }),
    ).toThrow(/script shim/u);
    expect(isUnsafeShimArgument('a\nb')).toBe(true);
    expect(isUnsafeShimArgument('--flag=value')).toBe(false);
    expect(isUnsafeShimArgument('plain-arg.txt')).toBe(false);
  });

  it.each([
    'x" & whoami & "',
    'a&b',
    'a|b',
    'a<b',
    'a>b',
    'a^b',
    '(a)',
    'a!b',
    'ends-in-slash' + '\\',
    '%PATH%',
  ])('refuses the cmd.exe metacharacter argument %j', (argument) => {
    expect(isUnsafeShimArgument(argument)).toBe(true);
  });

  it('refuses a git flag that names a program, even with no write scope', () => {
    const runtime = windows(['C:\\tools\\git.EXE']);
    const request = {
      executable: 'git',
      arguments: ['fetch', '--upload-pack=calc'],
      cwd: 'C:\\work',
      timeoutMs: 1_000,
      maxOutputChars: 1_000,
      background: false,
    };
    expect(() =>
      launchCommand(request, { ...runtime, environment: { Path: 'C:\\tools' } }),
    ).toThrow(/upload-pack/u);
  });

  it('refuses a double-quote injection before cmd.exe is started', () => {
    const runtime = windows(['C:\\tools\\npm.CMD']);
    const request = {
      executable: 'npm',
      arguments: ['run', 'x" & whoami & "'],
      cwd: 'C:\\work',
      timeoutMs: 1_000,
      maxOutputChars: 1_000,
      background: false,
    };
    expect(() =>
      launchCommand(request, { ...runtime, environment: { Path: 'C:\\tools' } }),
    ).toThrow(/script shim/u);
  });
});

describe('commandEnvironment', () => {
  const source = {
    Path: 'C:\\tools',
    PATH: 'C:\\tools',
    ComSpec: 'C:\\Windows\\system32\\cmd.exe',
    PATHEXT: '.EXE;.CMD',
    SystemRoot: 'C:\\Windows',
    APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
    TEMP: 'C:\\Temp',
    USERPROFILE: 'C:\\Users\\me',
    GH_TOKEN: 'secret',
    NPM_TOKEN: 'secret',
    AWS_ACCESS_KEY_ID: 'secret',
    AWS_SESSION_TOKEN: 'secret',
    CLAW_PASSWORD: 'secret',
    CLAW_TOKEN: 'secret',
    CLAW_EMAIL: 'secret',
    HTTPS_PROXY: 'http://user:secret@proxy',
  };

  it('keeps what npm, git and node need on Windows and drops every secret', () => {
    const environment = commandEnvironment(source, 'win32');

    expect(environment).toMatchObject({
      ComSpec: 'C:\\Windows\\system32\\cmd.exe',
      PATHEXT: '.EXE;.CMD',
      SystemRoot: 'C:\\Windows',
      APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
      TEMP: 'C:\\Temp',
      USERPROFILE: 'C:\\Users\\me',
    });
    expect(Object.values(environment)).not.toContain('secret');
    expect(Object.keys(environment).filter((key) => key.toLowerCase() === 'path')).toHaveLength(1);
  });

  it('forces non-interactive, uncoloured CI behaviour', () => {
    expect(commandEnvironment({ HOME: '/home/me', PATH: '/bin' }, 'linux')).toMatchObject({
      HOME: '/home/me',
      PATH: '/bin',
      CI: 'true',
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      GIT_TERMINAL_PROMPT: '0',
    });
  });

  it('overrides a CI setting the parent had', () => {
    expect(commandEnvironment({ CI: 'false', NO_COLOR: '0' }, 'linux')).toMatchObject({
      CI: 'true',
      NO_COLOR: '1',
    });
  });
});

describe('command tool definition', () => {
  it('declares every argument, bounded, with no extras allowed', () => {
    expect(COMMAND_TOOL_INPUT_SCHEMA.additionalProperties).toBe(false);
    expect(Object.keys(COMMAND_TOOL_INPUT_SCHEMA.properties).sort()).toEqual(
      [
        'arguments',
        'background',
        'cwd',
        'executable',
        'maxOutputChars',
        'processId',
        'sinceOffset',
        'timeoutMs',
      ].sort(),
    );
    // The schema is sent slim; the tool itself enforces the bounds on arrival.
    const parsed = parseRunRequest(
      { executable: 'node', timeoutMs: 99_999_999, maxOutputChars: 9_999_999 },
      process.cwd(),
    );
    expect(parsed.timeoutMs).toBe(1_800_000);
    expect(parsed.maxOutputChars).toBe(48_000);
    expect(() =>
      parseRunRequest(
        { executable: 'node', arguments: Array<string>(51).fill('x') },
        process.cwd(),
      ),
    ).toThrow(/at most 50/u);
  });

  it('puts run, output, wait and stop in the command category', () => {
    for (const operation of ['run', 'output', 'wait', 'stop']) {
      expect(toolCategory({ toolName: 'workspace.command', operation, arguments: {} })).toBe(
        'command',
      );
    }
    const offered = offeredDefinitions(['command']) as { name: string; operations: string[] }[];

    expect(offered.find((tool) => tool.name === 'workspace.command')?.operations).toEqual([
      'run',
      'output',
      'wait',
      'stop',
    ]);
    expect(offeredDefinitions(['read'])).not.toContainEqual(
      expect.objectContaining({ name: 'workspace.command' }),
    );
  });
});
