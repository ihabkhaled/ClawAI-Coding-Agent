import { spawnSync } from 'node:child_process';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execPath } from 'node:process';

const SDK_TYPES_CONFIG = 'tsconfig.sdk-types.json';
const SDK_TYPES_DIR = 'dist/sdk-types';
// Beside dist/sdk.mjs, TypeScript looks for sdk.d.mts, never sdk.d.ts.
const SDK_TYPES_ENTRY = 'dist/sdk.d.mts';
const RELATIVE_SPECIFIER = /(from\s+|import\(\s*)(['"])(\.{1,2}\/[^'"]+?)(?<!\.js)\2/g;

async function declarationFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return declarationFiles(path);
      return entry.name.endsWith('.d.ts') ? [path] : [];
    }),
  );
  return nested.flat();
}

/**
 * Emits the SDK's public declarations next to dist/sdk.mjs.
 *
 * The compiler writes extensionless relative specifiers, which only a bundler
 * resolves; `.js` is appended so a NodeNext consumer resolves them too.
 */
export async function emitSdkTypes() {
  await rm(SDK_TYPES_DIR, { recursive: true, force: true });
  const compiler = join('node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(execPath, [compiler, '-p', SDK_TYPES_CONFIG], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`SDK declaration emit failed (${SDK_TYPES_CONFIG})`);

  for (const file of await declarationFiles(SDK_TYPES_DIR)) {
    const source = await readFile(file, 'utf8');
    await writeFile(file, source.replace(RELATIVE_SPECIFIER, '$1$2$3.js$2'));
  }
  await writeFile(SDK_TYPES_ENTRY, "export * from './sdk-types/sdk/index.js';\n");
}
