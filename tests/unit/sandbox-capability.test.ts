import { describe, expect, it } from 'vitest';

import {
  chooseSandbox,
  isolatesCommands,
  sandboxGuarantees,
} from '../../src/core/sandbox-capability';

describe('chooseSandbox', () => {
  it('uses bubblewrap on Linux when it is there', () => {
    expect(chooseSandbox({ platform: 'linux', available: ['bwrap'] })).toBe('linux-bubblewrap');
  });

  it('reports none on Linux without it, rather than claiming a sandbox', () => {
    expect(chooseSandbox({ platform: 'linux', available: [] })).toBe('none');
  });

  it('uses seatbelt on macOS when it is there', () => {
    expect(chooseSandbox({ platform: 'darwin', available: ['sandbox-exec'] })).toBe(
      'macos-seatbelt',
    );
  });

  it('does not accept a helper that belongs to another platform', () => {
    expect(chooseSandbox({ platform: 'darwin', available: ['bwrap'] })).toBe('none');
    expect(chooseSandbox({ platform: 'linux', available: ['sandbox-exec'] })).toBe('none');
  });

  it('names job objects on Windows, which need no helper', () => {
    expect(chooseSandbox({ platform: 'win32', available: [] })).toBe('windows-job-object');
  });

  it('reports none on a platform it knows nothing about', () => {
    expect(chooseSandbox({ platform: 'aix', available: ['bwrap'] })).toBe('none');
  });
});

describe('sandboxGuarantees', () => {
  it('says plainly that an unsandboxed host is unsandboxed', () => {
    const guarantees = sandboxGuarantees('none');

    expect(guarantees.filesystemJail).toBe(false);
    expect(guarantees.networkIsolation).toBe(false);
    expect(guarantees.summary).toContain('No OS sandbox');
  });

  it('does not claim a filesystem jail for job objects, which do not give one', () => {
    const guarantees = sandboxGuarantees('windows-job-object');

    expect(guarantees.processContainment).toBe(true);
    expect(guarantees.filesystemJail).toBe(false);
  });

  it('carries the kind it was asked about', () => {
    expect(sandboxGuarantees('linux-bubblewrap').kind).toBe('linux-bubblewrap');
  });
});

describe('isolatesCommands', () => {
  it('needs both halves, because half of it is not isolation', () => {
    expect(isolatesCommands('linux-bubblewrap')).toBe(true);
    expect(isolatesCommands('macos-seatbelt')).toBe(true);
    expect(isolatesCommands('windows-job-object')).toBe(false);
    expect(isolatesCommands('none')).toBe(false);
  });
});
