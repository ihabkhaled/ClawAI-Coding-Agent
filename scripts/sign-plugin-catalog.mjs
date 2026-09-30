// Signs every plugin entry of a marketplace catalog with an Ed25519 private key.
//
//   node scripts/sign-plugin-catalog.mjs <private-key.pem> <clawai-marketplace.json>
//
// Prints the catalog with a `signature` (base64) added to each entry. Generate a
// key with `openssl genpkey -algorithm ed25519 -out key.pem` and publish the
// matching public key (`openssl pkey -in key.pem -pubout -outform DER | base64`)
// to your users for `clawAI.trustedPluginPublishers`. The signed text is the
// canonical JSON described in docs/CLAWAI_FOLDER_SPEC.md and produced by
// `canonicalEntryJson` in src/core/plugin-signature.ts; keep the two identical.
import { Buffer } from 'node:buffer';
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { argv, exit, stderr, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

export function canonicalEntryJson(entry) {
  return JSON.stringify({
    name: entry.name,
    publisher: entry.publisher,
    sha256: entry.sha256,
    source: entry.source,
    version: entry.version,
  });
}

export function signEntry(entry, privateKey) {
  return sign(null, Buffer.from(canonicalEntryJson(entry), 'utf8'), privateKey).toString('base64');
}

export function signCatalog(catalog, privateKey) {
  return {
    ...catalog,
    plugins: catalog.plugins.map((entry) => ({
      ...entry,
      signature: signEntry(entry, privateKey),
    })),
  };
}

function main() {
  const [keyPath, catalogPath] = argv.slice(2);
  if (keyPath === undefined || catalogPath === undefined) {
    stderr.write('usage: node scripts/sign-plugin-catalog.mjs <private-key.pem> <catalog.json>\n');
    exit(2);
  }
  const key = createPrivateKey(readFileSync(keyPath));
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  stdout.write(`${JSON.stringify(signCatalog(catalog, key), null, 2)}\n`);
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) main();
