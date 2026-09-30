// Regenerates docs/PERMISSION_MATRIX.md.
//
// The matrix is computed by running the real policy code, which is TypeScript
// that imports nothing a plain Node process can load, so the work happens in a
// vitest test. That test rewrites the document when UPDATE_PERMISSION_MATRIX=1
// and otherwise fails when the committed file is stale.
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'tests/unit/permission-matrix.test.ts'],
  { stdio: 'inherit', env: { ...process.env, UPDATE_PERMISSION_MATRIX: '1' } },
);
process.exit(result.status ?? 1);
