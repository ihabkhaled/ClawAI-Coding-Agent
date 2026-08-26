import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyCoverageScope } from '../../scripts/labs/verify-coverage-scope.mjs';

const criticalFiles = [
  'src/core/runtime/runtime-event-reducer.ts',
  'src/core/runtime/runtime-run-budget.ts',
  'src/core/session-vault.ts',
  'src/core/workspace-path-policy.ts',
  'src/services/safe-edit-service.ts',
];

test('accepts complete critical coverage', () => {
  const result = verifyCoverageScope({
    sourceFiles: criticalFiles,
    includedFiles: criticalFiles,
    criticalFiles,
  });
  assert.deepEqual(result.missing, []);
});

test('reports a new runtime boundary omitted from coverage', () => {
  const newBoundary = 'src/core/runtime/new-boundary.ts';
  const result = verifyCoverageScope({
    sourceFiles: [...criticalFiles, newBoundary],
    includedFiles: criticalFiles,
    criticalFiles,
  });
  assert.deepEqual(result.missing, [newBoundary]);
});

test('reports named critical files omitted from coverage', () => {
  const result = verifyCoverageScope({
    sourceFiles: criticalFiles,
    includedFiles: criticalFiles.slice(1),
    criticalFiles,
  });
  assert.deepEqual(result.missing, ['src/core/runtime/runtime-event-reducer.ts']);
});
