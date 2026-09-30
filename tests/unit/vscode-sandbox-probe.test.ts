import { describe, expect, it } from 'vitest';

import { present, VscodeSandboxProbe } from '../../src/infrastructure/vscode-sandbox-probe';

describe('sandbox probe', () => {
  it('reports a helper that cannot be started as absent', () => {
    expect(present('claw-definitely-not-a-real-helper')).toBe(false);
  });

  it('reports an executable that runs as present', () => {
    expect(present(process.execPath)).toBe(true);
  });

  it('probes once and returns the same answer for the session', () => {
    const probe = new VscodeSandboxProbe();
    const first = probe.guarantees();
    expect(probe.guarantees()).toBe(first);
  });
});
