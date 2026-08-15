import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_SCAN_EXCLUDE_GLOB,
  WORKSPACE_SCAN_EXCLUDED_DIRECTORIES,
  WORKSPACE_SCAN_MAX_RESULTS,
} from '../../src/infrastructure/workspace-scan.constants';

// `findFiles` does not consult .gitignore, so the exclude glob is the only
// thing standing between the index and a directory nobody wants indexed. A
// repository that keeps git worktrees inside itself had 2,042,172 files under
// .worktrees/, and every run stalled at "Reading workspace" without reaching a
// single model turn.

describe('workspace scan exclusions', () => {
  it('excludes .worktrees, which is what stalled the scan', () => {
    expect(WORKSPACE_SCAN_EXCLUDED_DIRECTORIES).toContain('.worktrees');
    expect(WORKSPACE_SCAN_EXCLUDE_GLOB).toContain('.worktrees');
  });

  it('keeps excluding the dependency and build output it always did', () => {
    for (const directory of [
      '.git',
      'node_modules',
      'vendor',
      'target',
      'dist',
      'build',
      '.next',
      'coverage',
    ]) {
      expect(WORKSPACE_SCAN_EXCLUDED_DIRECTORIES).toContain(directory);
    }
  });

  it('builds a single brace glob findFiles can use', () => {
    // One `**/{a,b,c}/**` pattern, not a list — findFiles takes exactly one
    // exclude, so a malformed join would silently exclude nothing.
    expect(WORKSPACE_SCAN_EXCLUDE_GLOB.startsWith('**/{')).toBe(true);
    expect(WORKSPACE_SCAN_EXCLUDE_GLOB.endsWith('}/**')).toBe(true);
    expect(WORKSPACE_SCAN_EXCLUDE_GLOB).not.toContain('{{');
  });

  it('keeps a result ceiling as a second line of defence', () => {
    expect(WORKSPACE_SCAN_MAX_RESULTS).toBeGreaterThan(0);
    expect(Number.isInteger(WORKSPACE_SCAN_MAX_RESULTS)).toBe(true);
  });
});
