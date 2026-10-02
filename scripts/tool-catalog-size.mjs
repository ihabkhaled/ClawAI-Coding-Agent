// Prints how many characters (and roughly how many tokens) each tool definition
// costs on EVERY model turn, for the default grants, + command, and every
// category. Run: npm run tools:size (add --json for machine output). It exits 1
// when a tool outgrows its budget in src/sdk/tool-catalog-budget.constants.ts,
// and tests/unit/tool-catalog-size.test.ts fails for the same reason.
import { build } from 'esbuild';
import process from 'node:process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const directory = await mkdtemp(join(tmpdir(), 'tool-size-'));
const outfile = join(directory, 'report.mjs');
try {
  await build({
    entryPoints: [join(root, 'src/sdk/tool-catalog-report.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile,
    logLevel: 'error',
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
  });
  const { printReport } = await import(pathToFileURL(outfile).href);
  process.exitCode = printReport(process.argv.includes('--json'));
} finally {
  await rm(directory, { recursive: true, force: true });
}
