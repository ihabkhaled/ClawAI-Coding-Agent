import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format } from 'prettier';

import { readReleaseIdentity } from './labs/release-identity.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const releaseIdentity = await readReleaseIdentity({ root });
if (releaseIdentity.dirty) {
  // Naming the paths matters: `builds/` output is deliberately excluded from
  // this check, so anything that reaches here is a real uncommitted source
  // change and the operator needs to know which one.
  throw new Error(
    `Supply-chain evidence requires a clean source tree. Uncommitted: ${releaseIdentity.dirtyPaths.join(', ')}`,
  );
}
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const components = Object.entries(lock.packages ?? {})
  .filter(([path]) => path.startsWith('node_modules/'))
  .map(([path, value]) => ({
    type: 'library',
    name: path.slice('node_modules/'.length),
    version: value.version ?? 'unknown',
    hashes: value.integrity === undefined ? [] : [{ alg: 'SHA-512', content: value.integrity }],
  }))
  .sort((left, right) => left.name.localeCompare(right.name));
const releaseBase = `clawai-coding-agent-${packageJson.version}`;
const builds = join(root, 'builds');
const writeJsonArtifact = async (suffix, value) => {
  const output = join(builds, `${releaseBase}.${suffix}.json`);
  const serialized = await format(JSON.stringify(value), { parser: 'json' });
  await writeFile(output, serialized);
  await writeFile(
    `${output}.sha256`,
    `${createHash('sha256').update(serialized).digest('hex')}  ${output.split(/[\\/]/u).at(-1)}\n`,
  );
  return output;
};
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  version: 1,
  metadata: {
    component: { type: 'application', name: packageJson.name, version: packageJson.version },
  },
  components,
};
const spdx = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: releaseBase,
  documentNamespace: `https://github.com/ihabkhaled/ClawAI-Coding-Agent/releases/tag/v${packageJson.version}/sbom`,
  creationInfo: {
    creators: ['Tool: clawai-coding-agent/generate-supply-chain'],
    created: '1970-01-01T00:00:00Z',
  },
  packages: components.map((component, index) => ({
    SPDXID: `SPDXRef-Package-${String(index + 1)}`,
    name: component.name,
    versionInfo: component.version,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: 'NOASSERTION',
    copyrightText: 'NOASSERTION',
  })),
};

await mkdir(builds, { recursive: true });
const cdxPath = await writeJsonArtifact('cdx', sbom);
const spdxPath = await writeJsonArtifact('spdx', spdx);
const vsixPath = join(builds, `${releaseBase}.vsix`);
const vsixBytes = await readFile(vsixPath);
const vsixDigest = createHash('sha256').update(vsixBytes).digest('hex');
await writeFile(`${vsixPath}.sha256`, `${vsixDigest}  ${releaseBase}.vsix\n`);
const provenance = {
  _type: 'https://in-toto.io/Statement/v1',
  subject: [{ name: `${releaseBase}.vsix`, digest: { sha256: vsixDigest } }],
  predicateType: 'https://slsa.dev/provenance/v1',
  predicate: {
    buildDefinition: {
      buildType: 'https://github.com/ihabkhaled/ClawAI-Coding-Agent/.github/workflows/release.yml',
      externalParameters: { version: packageJson.version },
      internalParameters: { sourceDirty: releaseIdentity.dirty },
      resolvedDependencies: [
        {
          uri: `${releaseIdentity.repositoryUri}@${releaseIdentity.commitSha}`,
          digest: { gitCommit: releaseIdentity.commitSha },
        },
        { uri: `pkg:npm/${packageJson.name}@${packageJson.version}` },
        { uri: `file:${cdxPath.split(/[\\/]/u).at(-1)}` },
        { uri: `file:${spdxPath.split(/[\\/]/u).at(-1)}` },
      ],
    },
    runDetails: {
      builder: { id: 'https://github.com/actions/runner' },
      metadata: { invocationId: `clawai-coding-agent-${packageJson.version}`, reproducible: true },
    },
  },
};
await writeJsonArtifact('provenance', provenance);
