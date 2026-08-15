import { describe, expect, it } from 'vitest';

import { inheritedEnvironmentKeys } from '../../src/infrastructure/bounded-command-runner';

describe('bounded-command-runner environment allowlist', () => {
  it('includes config directory variables required by gh and other tooling', () => {
    expect(inheritedEnvironmentKeys).toContain('APPDATA');
    expect(inheritedEnvironmentKeys).toContain('LOCALAPPDATA');
    expect(inheritedEnvironmentKeys).toContain('XDG_CONFIG_HOME');
    expect(inheritedEnvironmentKeys).toContain('XDG_DATA_HOME');
    expect(inheritedEnvironmentKeys).toContain('XDG_CACHE_HOME');
  });
});
