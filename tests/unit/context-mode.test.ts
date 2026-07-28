import { describe, expect, it } from 'vitest';

import { resolveSmartContext } from '../../src/core/context-mode';

describe('smart context resolution', () => {
  it('prefers a selected range, then the active file, then a trusted workspace', () => {
    expect(
      resolveSmartContext({
        hasActiveFile: true,
        hasSelection: true,
        hasWorkspace: true,
        trusted: true,
      }),
    ).toBe('selection');
    expect(
      resolveSmartContext({
        hasActiveFile: true,
        hasSelection: false,
        hasWorkspace: true,
        trusted: true,
      }),
    ).toBe('file');
    expect(
      resolveSmartContext({
        hasActiveFile: false,
        hasSelection: false,
        hasWorkspace: true,
        trusted: true,
      }),
    ).toBe('workspace');
  });

  it('uses no file context when no editor or trusted workspace is available', () => {
    expect(
      resolveSmartContext({
        hasActiveFile: false,
        hasSelection: false,
        hasWorkspace: false,
        trusted: true,
      }),
    ).toBe('none');
    expect(
      resolveSmartContext({
        hasActiveFile: false,
        hasSelection: false,
        hasWorkspace: true,
        trusted: false,
      }),
    ).toBe('none');
  });
});
