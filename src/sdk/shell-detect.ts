import path from 'node:path';

import { executableCandidates } from '../core/executable-candidates';

import {
  SHELL_GIT_BASH_SUBPATHS,
  SHELL_GIT_SH_SUBPATHS,
  SHELL_POSIX_BASH,
  SHELL_POSIX_SH,
  SHELL_WSL_LAUNCHER,
} from './shell-tool.constants';

import type { CommandRuntime } from './command-tool.types';
import type { ResolvedShell, ShellKind } from './shell-tool.types';

type Environment = Readonly<Record<string, string | undefined>>;

function value(environment: Environment, name: string): string | undefined {
  const wanted = name.toLowerCase();
  const key = Object.keys(environment).find((candidate) => candidate.toLowerCase() === wanted);
  const found = key === undefined ? undefined : environment[key];
  return found === undefined || found.length === 0 ? undefined : found;
}

function programRoots(environment: Environment): string[] {
  const local = value(environment, 'LOCALAPPDATA');
  return [
    value(environment, 'ProgramFiles'),
    value(environment, 'ProgramW6432'),
    value(environment, 'ProgramFiles(x86)'),
    local === undefined ? undefined : path.win32.join(local, 'Programs'),
  ].filter((root): root is string => root !== undefined);
}

function fromPath(name: string, runtime: CommandRuntime): string[] {
  return executableCandidates(name, runtime.environment, runtime.platform).filter(
    (candidate) => !SHELL_WSL_LAUNCHER.test(candidate),
  );
}

function gitCandidates(subpaths: readonly string[], environment: Environment): string[] {
  return programRoots(environment).flatMap((root) =>
    subpaths.map((subpath) => path.win32.join(root, subpath)),
  );
}

/** Where a shell of this kind may live on this machine, best first. */
function candidates(kind: ShellKind, runtime: CommandRuntime): string[] {
  const windows = runtime.platform === 'win32';
  const system = value(runtime.environment, 'SystemRoot') ?? 'C:\\Windows';
  if (kind === 'bash') {
    return windows
      ? [
          ...gitCandidates(SHELL_GIT_BASH_SUBPATHS, runtime.environment),
          ...fromPath('bash', runtime),
        ]
      : [...fromPath('bash', runtime), ...SHELL_POSIX_BASH];
  }
  if (kind === 'sh') {
    return windows
      ? [...gitCandidates(SHELL_GIT_SH_SUBPATHS, runtime.environment), ...fromPath('sh', runtime)]
      : [...SHELL_POSIX_SH, ...fromPath('sh', runtime)];
  }
  if (kind === 'powershell') {
    return [
      ...fromPath('pwsh', runtime),
      ...(windows
        ? [
            path.win32.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
            ...fromPath('powershell', runtime),
          ]
        : []),
    ];
  }
  return windows
    ? [value(runtime.environment, 'ComSpec') ?? path.win32.join(system, 'System32', 'cmd.exe')]
    : [];
}

function powershellScript(script: string): string {
  // Native programs report through $LASTEXITCODE; cmdlets through $?. Return whichever failed.
  return `${script}\nif ($LASTEXITCODE) { exit $LASTEXITCODE } elseif (-not $?) { exit 1 }`;
}

function resolved(kind: ShellKind, file: string): ResolvedShell {
  if (kind === 'powershell') {
    return {
      kind,
      file,
      verbatim: false,
      argumentsFor: (script) => [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(powershellScript(script), 'utf16le').toString('base64'),
      ],
    };
  }
  if (kind === 'cmd') {
    return {
      kind,
      file,
      verbatim: true,
      argumentsFor: (script) => [
        '/d',
        '/s',
        '/c',
        `"${script.trim().replaceAll(/\r?\n/gu, ' & ')}"`,
      ],
    };
  }
  return {
    kind,
    file,
    verbatim: false,
    argumentsFor: (script) =>
      kind === 'bash' ? ['--noprofile', '--norc', '-c', script] : ['-c', script],
  };
}

/** The shells to try when the model names none, in order. */
export function defaultShellOrder(platform: NodeJS.Platform): readonly ShellKind[] {
  return platform === 'win32' ? ['bash', 'powershell', 'cmd'] : ['bash', 'sh', 'powershell'];
}

/** The shell kinds this machine has, for a message that tells the model what is available. */
export function availableShells(runtime: CommandRuntime): ShellKind[] {
  return (['bash', 'sh', 'powershell', 'cmd'] as const).filter(
    (kind) => findShell(kind, runtime) !== undefined,
  );
}

/** The shell of one kind on this machine, or undefined. */
export function findShell(kind: ShellKind, runtime: CommandRuntime): ResolvedShell | undefined {
  const file = candidates(kind, runtime).find((candidate) => runtime.exists(candidate));
  return file === undefined ? undefined : resolved(kind, file);
}

/** The first shell the machine has, in the default order; undefined when there is none. */
export function findDefaultShell(runtime: CommandRuntime): ResolvedShell | undefined {
  for (const kind of defaultShellOrder(runtime.platform)) {
    const shell = findShell(kind, runtime);
    if (shell !== undefined) return shell;
  }
  return undefined;
}
