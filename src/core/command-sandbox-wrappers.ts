import path from 'node:path';

import {
  CONTAINER_PIDS_LIMIT,
  CONTAINER_WORKSPACE,
  SANDBOX_CREDENTIAL_PATHS,
  SANDBOX_HELPER_EXECUTABLES,
} from './command-sandbox.constants';

import type {
  CommandSandboxHost,
  CommandSandboxLaunch,
  CommandSandboxMechanism,
  CommandSandboxSettings,
  SandboxedSpawn,
} from './command-sandbox.types';

/**
 * bubblewrap: the host filesystem read-only, the workspace and temp writable,
 * credential stores masked, and every namespace unshared — network included
 * unless it was allowed.
 *
 * Mount order is the policy. Later mounts sit on top of earlier ones, so the
 * read-only root comes first, the masks next, and the workspace bind last so a
 * mask can never hide the tree the command was asked to work on.
 */
export function bubblewrapArguments(
  launch: CommandSandboxLaunch,
  host: CommandSandboxHost,
  allowNetwork: boolean,
): string[] {
  const masks = host.existingCredentialPaths.flatMap((credential) =>
    credential.kind === 'directory'
      ? ['--tmpfs', credential.path]
      : ['--ro-bind', '/dev/null', credential.path],
  );
  const temporary = host.temporaryDirectories
    .filter((directory) => directory !== '/tmp' && !directory.startsWith('/tmp/'))
    .flatMap((directory) => ['--bind', directory, directory]);
  return [
    '--ro-bind',
    '/',
    '/',
    '--dev',
    '/dev',
    '--proc',
    '/proc',
    '--tmpfs',
    '/tmp',
    ...temporary,
    ...masks,
    '--bind',
    launch.workspaceRoot,
    launch.workspaceRoot,
    '--unshare-all',
    ...(allowNetwork ? ['--share-net'] : []),
    '--die-with-parent',
    '--new-session',
    '--chdir',
    launch.cwd,
    '--',
    launch.executable,
    ...launch.arguments,
  ];
}

/** A Seatbelt string literal; a quote or backslash in a path must not end it. */
function sbplString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

const MACOS_TEMPORARY = ['/private/tmp', '/private/var/folders'] as const;

/**
 * A Seatbelt profile: deny by default, read anything but credentials, write
 * only the workspace and temp, and no network unless allowed.
 *
 * In SBPL the last matching rule wins, which is why the credential deny comes
 * after the broad read allow, and the workspace write after both.
 */
export function seatbeltProfile(
  launch: CommandSandboxLaunch,
  host: CommandSandboxHost,
  allowNetwork: boolean,
): string {
  const credentials = SANDBOX_CREDENTIAL_PATHS.map(
    (relative) => `(subpath ${sbplString(path.posix.join(host.homeDirectory, relative))})`,
  ).join(' ');
  const writable = [launch.workspaceRoot, ...MACOS_TEMPORARY, ...host.temporaryDirectories]
    .map((directory) => `(subpath ${sbplString(directory)})`)
    .join(' ');
  return [
    '(version 1)',
    '(deny default)',
    '(allow process-exec)',
    '(allow process-fork)',
    '(allow signal (target same-sandbox))',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow ipc-posix-shm)',
    '(allow file-read*)',
    `(deny file-read* file-write* ${credentials})`,
    `(allow file-write* ${writable} (literal "/dev/null") (regex #"^/dev/tty") (subpath "/dev/fd"))`,
    '(allow file-ioctl (regex #"^/dev/tty"))',
    ...(allowNetwork ? ['(allow network*)'] : []),
  ].join('\n');
}

export function seatbeltArguments(
  launch: CommandSandboxLaunch,
  host: CommandSandboxHost,
  allowNetwork: boolean,
): string[] {
  return [
    '-p',
    seatbeltProfile(launch, host, allowNetwork),
    launch.executable,
    ...launch.arguments,
  ];
}

/**
 * Where the command's working directory lands inside the container.
 *
 * Refused rather than clamped when it is outside the workspace: the only
 * directory the container has is the workspace, and quietly running somewhere
 * else would run a different command from the one approved.
 */
function containerWorkdir(launch: CommandSandboxLaunch, host: CommandSandboxHost): string {
  const paths = host.platform === 'win32' ? path.win32 : path.posix;
  const relative = paths.relative(launch.workspaceRoot, launch.cwd);
  if (relative.startsWith('..') || paths.isAbsolute(relative))
    throw new Error('SANDBOX_CWD_OUTSIDE_WORKSPACE');
  const segments = relative.split(paths.sep).filter((segment) => segment.length > 0);
  return path.posix.join(CONTAINER_WORKSPACE, ...segments);
}

/**
 * docker: only the workspace is mounted, every capability dropped, no
 * privilege escalation, a PID ceiling, and `--network none` unless allowed.
 *
 * Only the command's declared variables cross into the container. The host's
 * inherited PATH and HOME describe the host, and would be wrong inside it.
 */
export function dockerArguments(
  launch: CommandSandboxLaunch,
  host: CommandSandboxHost,
  settings: CommandSandboxSettings,
): string[] {
  // `--mount` is comma-separated, so a comma in the path would inject options.
  if (launch.workspaceRoot.includes(',')) throw new Error('SANDBOX_WORKSPACE_PATH_UNSUPPORTED');
  // The image sits among docker's own arguments: a leading `-` would be read as
  // a flag (`--privileged`, `-v`), and whitespace or a control character is not
  // part of any image reference.
  const image = settings.dockerImage.trim();
  let unprintable = false;
  for (let index = 0; index < image.length; index += 1) {
    const code = image.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) unprintable = true;
  }
  if (image.startsWith('-') || unprintable) {
    throw new Error('SANDBOX_IMAGE_UNSUPPORTED');
  }
  const environment = Object.entries(launch.declaredEnvironment).flatMap(([key, value]) => [
    '--env',
    `${key}=${value}`,
  ]);
  return [
    'run',
    '--rm',
    '--interactive',
    '--network',
    settings.allowNetwork ? 'bridge' : 'none',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    String(CONTAINER_PIDS_LIMIT),
    '--mount',
    `type=bind,source=${launch.workspaceRoot},target=${CONTAINER_WORKSPACE}`,
    '--workdir',
    containerWorkdir(launch, host),
    ...environment,
    image,
    launch.executable,
    ...launch.arguments,
  ];
}

/**
 * The argv that confines `launch` with `mechanism`.
 *
 * `executable` in the result is the helper's name; the runner resolves it on
 * the host PATH like any other executable.
 */
export function wrapForSandbox(
  mechanism: CommandSandboxMechanism,
  launch: CommandSandboxLaunch,
  host: CommandSandboxHost,
  settings: CommandSandboxSettings,
): SandboxedSpawn {
  const executable = SANDBOX_HELPER_EXECUTABLES[mechanism];
  if (mechanism === 'bubblewrap')
    return { executable, arguments: bubblewrapArguments(launch, host, settings.allowNetwork) };
  if (mechanism === 'seatbelt')
    return { executable, arguments: seatbeltArguments(launch, host, settings.allowNetwork) };
  return { executable, arguments: dockerArguments(launch, host, settings) };
}
