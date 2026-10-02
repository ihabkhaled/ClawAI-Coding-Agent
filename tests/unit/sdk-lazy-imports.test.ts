import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

/**
 * Importing the SDK (or starting the editor) must not pay for tools it never calls.
 *
 * The bundle is built in memory exactly as `esbuild.mjs` builds `dist/sdk.mjs`, and
 * its import records are read: the browser library may only be reached by a dynamic
 * import, and node:http / node:https must not be loaded at import time (an ES-module
 * import of node:http makes Node load its bundled fetch client, undici, about 15 ms).
 */
const LAZY_ONLY = ['playwright-core', 'node:http', 'node:https', 'undici'];

async function importKinds(entry: string): Promise<Map<string, Set<string>>> {
  const result = await build({
    bundle: true,
    entryPoints: [entry],
    external: ['playwright-core'],
    format: 'esm',
    logLevel: 'silent',
    metafile: true,
    outfile: 'memory.mjs',
    platform: 'node',
    target: 'node20',
    write: false,
  });
  const kinds = new Map<string, Set<string>>();
  for (const output of Object.values(result.metafile.outputs)) {
    for (const record of output.imports) {
      const path = record.path.replace(/^node:/u, '');
      const set = kinds.get(path) ?? new Set<string>();
      set.add(record.kind);
      kinds.set(path, set);
    }
  }
  return kinds;
}

describe('lazy tool dependencies', () => {
  it.each(['src/sdk/index.ts', 'src/headless/headless-main.ts'])(
    '%s loads the browser library, http and undici only on first use',
    async (entry) => {
      const kinds = await importKinds(entry);
      const eager = LAZY_ONLY.map((name) => name.replace(/^node:/u, '')).filter((name) =>
        kinds.get(name)?.has('import-statement'),
      );
      // The headless bundle serves the MCP loopback listener, which is a real node:http server.
      const allowed = entry.includes('headless-main') ? ['http'] : [];
      expect(eager.filter((name) => !allowed.includes(name))).toEqual([]);
    },
    60_000,
  );
});
