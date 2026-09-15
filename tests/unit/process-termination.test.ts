import { describe, expect, it } from 'vitest';

import { terminationSteps, treeKillArguments } from '../../src/core/process-termination';
import { PROCESS_TERMINATION_GRACE_MS } from '../../src/core/process-termination.constants';

describe('terminationSteps', () => {
  it('asks first and kills second on POSIX, because SIGTERM is only a request', () => {
    const steps = terminationSteps('linux');

    expect(steps).toEqual([
      { kind: 'signal', signal: 'SIGTERM', afterMs: 0, forceful: false },
      {
        kind: 'signal',
        signal: 'SIGKILL',
        afterMs: PROCESS_TERMINATION_GRACE_MS,
        forceful: true,
      },
    ]);
  });

  it('gives macOS the same sequence as any other POSIX host', () => {
    expect(terminationSteps('darwin')).toEqual(terminationSteps('linux'));
  });

  it('kills the whole tree at once on Windows, which has no graceful signal', () => {
    expect(terminationSteps('win32')).toEqual([{ kind: 'tree-kill', afterMs: 0, forceful: true }]);
  });

  it('marks only the escalation as forceful, so a clean stop is not reported as a kill', () => {
    expect(terminationSteps('linux').filter((step) => step.forceful)).toHaveLength(1);
  });

  it('never leaves a platform with a step that could wait forever', () => {
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      const steps = terminationSteps(platform);

      expect(steps.length).toBeGreaterThan(0);
      expect(steps.some((step) => step.forceful)).toBe(true);
    }
  });
});

describe('treeKillArguments', () => {
  it('takes the descendants, which is the entire reason it is used', () => {
    expect(treeKillArguments(4321)).toContain('/T');
  });

  it('forces, because the polite form only posts a window message', () => {
    expect(treeKillArguments(4321)).toContain('/F');
  });

  it('names the process it was given', () => {
    expect(treeKillArguments(4321)).toEqual(['/pid', '4321', '/T', '/F']);
  });
});
