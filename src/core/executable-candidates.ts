import path from 'node:path';

const DEFAULT_PATHEXT = '.EXE;.CMD;.BAT;.COM';

function environmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const wanted = name.toLowerCase();
  const key = Object.keys(environment).find((candidate) => candidate.toLowerCase() === wanted);
  return key === undefined ? undefined : environment[key];
}

function windowsExtensions(environment: NodeJS.ProcessEnv): readonly string[] {
  return (environmentValue(environment, 'PATHEXT') ?? DEFAULT_PATHEXT)
    .split(';')
    .filter((extension) => extension.length > 0);
}

function candidateNames(
  executable: string,
  windows: boolean,
  extensions: readonly string[],
): readonly string[] {
  if (!windows) return [executable];
  const lower = executable.toLowerCase();
  const known = extensions.some((extension) => lower.endsWith(extension.toLowerCase()));
  const suffixed = extensions.map((extension) => `${executable}${extension}`);
  return known ? [executable, ...suffixed] : suffixed;
}

/**
 * Every file a bare or explicit executable name could mean, in search order.
 *
 * Windows needs a suffix from PATHEXT (npm and gh are `.cmd` shims) but also
 * accepts a name that already has one, and its PATH entries may be quoted.
 * An empty PATH entry is skipped: it would resolve against the working
 * directory, which is where a hostile repository puts its own `git`.
 */
export function executableCandidates(
  executable: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): readonly string[] {
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  const names = candidateNames(executable, windows, windows ? windowsExtensions(environment) : []);
  const explicit =
    paths.isAbsolute(executable) || executable.includes('/') || executable.includes('\\');
  if (explicit) return names;
  const directories = (environmentValue(environment, 'PATH') ?? '')
    .split(paths.delimiter)
    .map((directory) => (windows ? directory.replace(/^"(.*)"$/u, '$1') : directory))
    .filter((directory) => directory.length > 0);
  return directories.flatMap((directory) => names.map((name) => paths.join(directory, name)));
}
