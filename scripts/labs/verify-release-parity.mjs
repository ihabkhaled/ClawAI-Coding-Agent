import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import JSZip from 'jszip';

const execFileAsync = promisify(execFile);

function check(id, passed, detail) {
  return Object.freeze({ id, status: passed ? 'PASS' : 'FAIL', detail });
}

async function defaultVsixManifest(path) {
  const archive = await JSZip.loadAsync(await readFile(path));
  const entry = archive.file('extension/package.json');
  if (entry === null) throw new Error('VSIX has no extension/package.json');
  return JSON.parse(await entry.async('string'));
}

export async function verifyReleaseParity(options) {
  const root = options.root;
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const version = manifest.version;
  const base = `clawai-coding-agent-${version}`;
  const builds = join(root, 'builds');
  const vsixPath = join(builds, `${base}.vsix`);
  const vsixBytes = await readFile(vsixPath);
  const actualDigest = createHash('sha256').update(vsixBytes).digest('hex');
  const recordedDigest = (await readFile(`${vsixPath}.sha256`, 'utf8')).trim().split(/\s+/u)[0];
  const provenance = JSON.parse(await readFile(join(builds, `${base}.provenance.json`), 'utf8'));
  const vsixManifest = await (options.readVsixManifest ?? defaultVsixManifest)(vsixPath);
  const sourceDependency = provenance.predicate?.buildDefinition?.resolvedDependencies?.find(
    (dependency) => typeof dependency.digest?.gitCommit === 'string',
  );
  const remote = options.remoteRelease;
  const checks = [
    check(
      'lock-version',
      lock.version === version && lock.packages?.['']?.version === version,
      version,
    ),
    check('changelog-version', changelog.includes(`## ${version}`), version),
    check('readme-version', readme.includes(`Version \`${version}\` is current`), version),
    check('vsix-hash', recordedDigest === actualDigest, actualDigest),
    check(
      'vsix-manifest',
      vsixManifest.publisher === 'clawai' &&
        vsixManifest.name === 'clawai-coding-agent' &&
        vsixManifest.version === version,
      `${vsixManifest.publisher}.${vsixManifest.name}@${vsixManifest.version}`,
    ),
    check(
      'installed-version',
      options.installedExtensions.includes(`clawai.clawai-coding-agent@${version}`),
      version,
    ),
    options.publicationAuthorized === true
      ? check('git-tag', options.tags.includes(`v${version}`), `v${version}`)
      : Object.freeze({
          id: 'git-tag',
          status: 'BLOCKED_EXTERNAL',
          detail: 'tag creation not authorized',
        }),
    check(
      'provenance-subject',
      provenance.subject?.[0]?.digest?.sha256 === actualDigest,
      actualDigest,
    ),
    check(
      'provenance-source',
      sourceDependency?.digest?.gitCommit === options.sourceCommitSha,
      options.sourceCommitSha,
    ),
    remote === undefined
      ? Object.freeze({
          id: 'remote-release',
          status: 'BLOCKED_EXTERNAL',
          detail: 'remote not queried',
        })
      : check(
          'remote-release',
          remote.tag === `v${version}` && remote.assets.includes(`${base}.vsix`),
          remote.tag,
        ),
  ];
  return Object.freeze({
    version,
    checks: Object.freeze(checks),
    failures: Object.freeze(checks.filter(({ status }) => status === 'FAIL')),
  });
}

async function commandLines(command, args) {
  const result = await execFileAsync(command, args, { windowsHide: true });
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function runCli() {
  const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const sourceCommitSha = (await commandLines('git', ['rev-parse', 'HEAD']))[0];
  const result = await verifyReleaseParity({
    root,
    installedExtensions: await commandLines('code', ['--list-extensions', '--show-versions']),
    tags: await commandLines('git', ['tag', '--list', 'v*']),
    remoteRelease: undefined,
    publicationAuthorized: false,
    sourceCommitSha,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runCli();
}
