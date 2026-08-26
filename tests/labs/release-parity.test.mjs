import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { verifyReleaseParity } from '../../scripts/labs/verify-release-parity.mjs';

async function releaseFixture() {
  const root = await mkdtemp(join(tmpdir(), 'clawai-parity-'));
  const version = '0.64.3';
  const base = `clawai-coding-agent-${version}`;
  const builds = join(root, 'builds');
  await mkdir(builds);
  const vsix = Buffer.from('fixture-vsix');
  const digest = createHash('sha256').update(vsix).digest('hex');
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'clawai-coding-agent', version }),
  );
  await writeFile(
    join(root, 'package-lock.json'),
    JSON.stringify({ version, packages: { '': { version } } }),
  );
  await writeFile(join(root, 'CHANGELOG.md'), `## ${version}\n\n- Current release.\n`);
  await writeFile(join(root, 'README.md'), `## Status\n\nVersion \`${version}\` is current.\n`);
  await writeFile(join(builds, `${base}.vsix`), vsix);
  await writeFile(join(builds, `${base}.vsix.sha256`), `${digest}  ${base}.vsix\n`);
  await writeFile(join(builds, `${base}.cdx.json`), '{}\n');
  await writeFile(join(builds, `${base}.spdx.json`), '{}\n');
  await writeFile(
    join(builds, `${base}.provenance.json`),
    JSON.stringify({
      subject: [{ name: `${base}.vsix`, digest: { sha256: digest } }],
      predicate: {
        buildDefinition: { resolvedDependencies: [{ digest: { gitCommit: 'c'.repeat(40) } }] },
      },
    }),
  );
  return { root, version, digest };
}

test('passes matching local release identities and blocks an unavailable remote', async () => {
  const fixture = await releaseFixture();
  const result = await verifyReleaseParity({
    ...fixture,
    installedExtensions: [`clawai.clawai-coding-agent@${fixture.version}`],
    tags: [`v${fixture.version}`],
    publicationAuthorized: true,
    remoteRelease: undefined,
    sourceCommitSha: 'c'.repeat(40),
    readVsixManifest: async () => ({
      publisher: 'clawai',
      name: 'clawai-coding-agent',
      version: fixture.version,
    }),
  });

  assert.deepEqual(result.failures, []);
  assert.equal(result.checks.find(({ id }) => id === 'remote-release').status, 'BLOCKED_EXTERNAL');
});

test('reports each release mismatch by stable check id', async () => {
  const fixture = await releaseFixture();
  await writeFile(join(fixture.root, 'README.md'), 'Version `0.11.0` is current.\n');
  const result = await verifyReleaseParity({
    ...fixture,
    installedExtensions: ['clawai.clawai-coding-agent@0.64.2'],
    tags: [],
    publicationAuthorized: true,
    remoteRelease: { tag: 'v0.64.2', assets: [] },
    sourceCommitSha: 'd'.repeat(40),
    readVsixManifest: async () => ({
      publisher: 'clawai',
      name: 'clawai-coding-agent',
      version: '0.64.2',
    }),
  });

  assert.deepEqual(
    result.failures.map(({ id }) => id),
    [
      'readme-version',
      'vsix-manifest',
      'installed-version',
      'git-tag',
      'provenance-source',
      'remote-release',
    ],
  );
});
