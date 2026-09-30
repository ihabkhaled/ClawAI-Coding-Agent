import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { marketplaceCatalogSchema } from '../../src/core/plugin-marketplace.schema';
import { verifyEntrySignature } from '../../src/core/plugin-signature';

const catalog = {
  name: 'Acme',
  plugins: [
    {
      name: 'review-kit',
      publisher: 'acme',
      version: '1.0.0',
      description: 'Review helpers',
      source: 'review-kit.zip',
      sha256: 'c'.repeat(64),
    },
  ],
};

describe('scripts/sign-plugin-catalog.mjs', () => {
  it('prints a catalog whose signatures verify with the extension verifier', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const directory = mkdtempSync(join(tmpdir(), 'sign-catalog-'));
    const keyPath = join(directory, 'key.pem');
    const catalogPath = join(directory, 'clawai-marketplace.json');
    writeFileSync(keyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }));
    writeFileSync(catalogPath, JSON.stringify(catalog));

    const run = spawnSync(
      process.execPath,
      ['scripts/sign-plugin-catalog.mjs', keyPath, catalogPath],
      { encoding: 'utf8' },
    );
    const signedCatalog = marketplaceCatalogSchema.parse(JSON.parse(run.stdout));
    const [entry] = signedCatalog.plugins;
    if (entry === undefined) throw new Error('no entry');
    const trusted = { acme: publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };

    expect(run.status).toBe(0);
    expect(verifyEntrySignature(entry, entry.signature, trusted).status).toBe('signed');
    expect(
      verifyEntrySignature({ ...entry, version: '1.0.1' }, entry.signature, trusted).status,
    ).toBe('invalid');
  });

  it('exits with usage when arguments are missing', () => {
    const run = spawnSync(process.execPath, ['scripts/sign-plugin-catalog.mjs'], {
      encoding: 'utf8',
    });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain('usage:');
  });
});
