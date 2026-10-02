// Regenerates docs/TOOLS.md.
//
// The catalog is computed from the real tool definitions and the real permission
// code, which are TypeScript a plain Node process cannot load, so the work
// happens in a vitest test. That test rewrites the document when
// UPDATE_TOOLS_DOC=1 and otherwise fails when the committed file is stale.
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'tests/unit/tools-doc.test.ts'],
  { stdio: 'inherit', env: { ...process.env, UPDATE_TOOLS_DOC: '1' } },
);
process.exit(result.status ?? 1);
