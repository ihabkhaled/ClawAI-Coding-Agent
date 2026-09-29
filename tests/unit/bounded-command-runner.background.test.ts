import { describe, expect, it } from 'vitest';

import { prepareBackgroundLaunch } from '../../src/infrastructure/bounded-command-runner';

function spec(overrides: Record<string, unknown> = {}): unknown {
  return {
    executable: process.execPath,
    arguments: ['-e', '1'],
    cwdRootKey: 'workspace-root',
    cwd: '.',
    environment: { CUSTOM_FLAG: '1' },
    timeoutMs: 10_000,
    outputLimitBytes: 4_096,
    expectedEffect: 'build',
    targetId: 'target:workspace',
    background: true,
    ...overrides,
  };
}

describe('prepareBackgroundLaunch', () => {
  it('resolves the executable and builds an allowlisted environment', async () => {
    const plan = await prepareBackgroundLaunch(spec());

    expect(plan.executablePath.toLowerCase()).toContain('node');
    expect(plan.arguments).toEqual(['-e', '1']);
    expect(plan.environment.CUSTOM_FLAG).toBe('1');
    expect(Object.keys(plan.environment).some((key) => /TOKEN|SECRET|KEY/iu.test(key))).toBe(false);
  });

  it('refuses stdin and elevation', async () => {
    await expect(prepareBackgroundLaunch(spec({ stdin: 'x' }))).rejects.toThrow('stdin');
    await expect(prepareBackgroundLaunch(spec({ elevation: true }))).rejects.toThrow(
      'ELEVATION_NOT_AVAILABLE',
    );
  });
});
