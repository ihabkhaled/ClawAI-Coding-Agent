import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const LAB_DIRECTORIES = Object.freeze(['runs', 'profiles', 'workspaces', 'artifacts']);

async function defaultCommandRunner(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    windowsHide: true,
    env: { ...process.env, ...options.env },
  });
  return result.stdout.trim();
}

function firstLine(value) {
  return value.split(/\r?\n/u)[0]?.trim() ?? '';
}

async function resolveVscodeInvocation() {
  if (process.platform !== 'win32') return { command: 'code', prefixArgs: [], env: {} };
  const result = await execFileAsync('where.exe', ['code.cmd'], { windowsHide: true });
  const shim = firstLine(result.stdout);
  if (shim.length === 0) throw new Error('VS Code command shim was not found.');
  const installationRoot = resolve(dirname(shim), '..');
  const candidates = await readdir(installationRoot, { withFileTypes: true });
  for (const candidate of candidates) {
    if (!candidate.isDirectory()) continue;
    const cliPath = join(installationRoot, candidate.name, 'resources', 'app', 'out', 'cli.js');
    try {
      await access(cliPath);
      return {
        command: join(installationRoot, 'Code.exe'),
        prefixArgs: [cliPath],
        env: { ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' },
      };
    } catch {
      // Continue until the installed commit directory is found.
    }
  }
  throw new Error('VS Code CLI entrypoint was not found.');
}

export async function bootstrapLab(options) {
  const { rawRoot, packageVersion, vsixBytes } = options;
  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const vscodeInvocation =
    options.vscodeCommand === undefined
      ? await resolveVscodeInvocation()
      : { command: options.vscodeCommand, prefixArgs: [], env: {} };
  for (const directory of LAB_DIRECTORIES) {
    await mkdir(join(rawRoot, directory), { recursive: true });
  }
  const extensionSha = firstLine(await commandRunner('git', ['rev-parse', 'HEAD']));
  const parentRoot = firstLine(
    await commandRunner('git', ['rev-parse', '--show-superproject-working-tree']),
  );
  const parentSha =
    parentRoot.length === 0
      ? 'standalone'
      : firstLine(
          await commandRunner('git', ['-C', parentRoot.replaceAll('\\', '/'), 'rev-parse', 'HEAD']),
        );
  const vscodeVersion = firstLine(
    await commandRunner(
      vscodeInvocation.command,
      [...vscodeInvocation.prefixArgs, '--version'],
      vscodeInvocation,
    ),
  );
  const installed = await commandRunner(
    vscodeInvocation.command,
    [...vscodeInvocation.prefixArgs, '--list-extensions', '--show-versions'],
    vscodeInvocation,
  );
  const installedMatch = installed.match(/^clawai\.clawai-coding-agent@(.+)$/mu);
  const baseline = Object.freeze({
    schemaVersion: 1,
    extensionSha,
    parentSha,
    packageVersion,
    installedVsixVersion: installedMatch?.[1] ?? 'not-installed',
    vsixSha256: createHash('sha256').update(vsixBytes).digest('hex'),
    nodeVersion: process.version,
    os: `${platform()}-${arch()}`,
    vscodeVersion,
  });
  await writeFile(join(rawRoot, 'baseline.json'), `${JSON.stringify(baseline, null, 2)}\n`);
  return baseline;
}

async function runCli() {
  const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const vsixPath = join(root, 'builds', `clawai-coding-agent-${packageJson.version}.vsix`);
  const vsixBytes = await readFile(vsixPath);
  const baseline = await bootstrapLab({
    root,
    rawRoot: join(root, '.clawai-lab'),
    packageVersion: packageJson.version,
    vsixBytes,
  });
  process.stdout.write(`${JSON.stringify(baseline, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runCli();
}
